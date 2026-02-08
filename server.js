// ClearMindAI server — Express backend for a developer journaling app
// with AI-powered analysis, coaching, and growth tracking via Groq LLMs

import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import Groq from 'groq-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// reads env each call so tests can swap dirs between runs
function getDataDir() {
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// groq client — reinitializable when user provides their own key
let groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });

function getConfigFile() {
  return path.join(getDataDir(), 'config.json');
}

function loadConfig() {
  try {
    const file = getConfigFile();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveConfig(config) {
  fs.writeFileSync(getConfigFile(), JSON.stringify(config, null, 2));
}

// swappable for tests since groq-sdk has its own http client
let _groqChat = async (messages, options = {}) => {
  const completion = await groq.chat.completions.create({
    model: options.model || 'llama-3.1-8b-instant',
    messages,
    temperature: options.temperature || 0.3,
    max_tokens: options.max_tokens || 1024,
  });
  return completion.choices[0]?.message?.content || '';
};

export function setGroqChat(fn) {
  _groqChat = fn;
}

// streaming version of groqChat — yields tokens one at a time
let _groqChatStream = async function* (messages, options = {}) {
  const stream = await groq.chat.completions.create({
    model: options.model || 'llama-3.1-8b-instant',
    messages,
    temperature: options.temperature || 0.3,
    max_tokens: options.max_tokens || 1024,
    stream: true,
  });
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) yield token;
  }
};

export function setGroqChatStream(fn) {
  _groqChatStream = fn;
}

export async function* groqChatStream(messages, options = {}) {
  yield* _groqChatStream(messages, options);
}

// sets up server-sent events for real-time streaming
function initSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  return {
    sendToken(token) { res.write(`data: ${JSON.stringify({ token })}\n\n`); },
    sendJson(obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`); },
    done() { res.write('data: [DONE]\n\n'); res.end(); },
    error(msg) { res.write(`data: ${JSON.stringify({ error: msg })}\n\n`); res.end(); },
  };
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'clearmind-dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// helper functions

function getUsersFile() {
  return path.join(getDataDir(), 'users.json');
}

function getEntriesFile(userId) {
  return path.join(getDataDir(), `entries_${userId}.json`);
}

function loadJSON(filepath) {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    }
  } catch (e) {
    console.error(`Error loading ${filepath}:`, e.message);
  }
  return [];
}

function saveJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

/*
 * Poor man's text embeddings — we hash character trigrams into a fixed-size
 * vector so we can do similarity search without calling an external API.
 * Not as smart as real embeddings but works surprisingly well for journals.
 */
export function getEmbedding(text) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const dim = 384;
  const vector = new Array(dim).fill(0);

  for (let i = 0; i < normalized.length - 2; i++) {
    const trigram = normalized.substring(i, i + 3);
    let hash = 0;
    for (let j = 0; j < trigram.length; j++) {
      hash = ((hash << 5) - hash + trigram.charCodeAt(j)) | 0;
    }
    const index = Math.abs(hash) % dim;
    vector[index] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dim; i++) {
      vector[i] /= magnitude;
    }
  }

  return vector;
}

export function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// LLMs love wrapping JSON in markdown fences, so we handle that
export function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    // try markdown code block
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1].trim()); } catch {}
    }
    // try bare object
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch {}
    }
    // try bare array
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try { return JSON.parse(arrMatch[0]); } catch {}
    }
    return null;
  }
}

export async function groqChat(messages, options = {}) {
  return _groqChat(messages, options);
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// authentication

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const users = loadJSON(getUsersFile());
    if (users.find(u => u.email === email)) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      email,
      name: name || email.split('@')[0],
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };

    users.push(user);
    saveJSON(getUsersFile(), users);
    saveJSON(getEntriesFile(user.id), []);

    req.session.userId = user.id;
    const { password: _, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = loadJSON(getUsersFile());
    const user = users.find(u => u.email === email);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.userId = user.id;
    const { password: _, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  const users = loadJSON(getUsersFile());
  const user = users.find(u => u.id === req.session.userId);
  if (!user) return res.json({ user: null });
  const { password: _, ...safeUser } = user;
  res.json({ user: safeUser });
});

app.post('/api/auth/signout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// journal entries crud

app.post('/api/entries', requireAuth, (req, res) => {
  try {
    const { content, title } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const entries = loadJSON(getEntriesFile(req.session.userId));
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      title: title || 'Untitled Entry',
      content: content.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      embedding: getEmbedding(content)
    };

    entries.push(entry);
    saveJSON(getEntriesFile(req.session.userId), entries);
    res.json({ entry });
  } catch (error) {
    console.error('Create entry error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/entries', requireAuth, (req, res) => {
  try {
    const entries = loadJSON(getEntriesFile(req.session.userId));
    entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    // strip embeddings from response, they're huge
    const clean = entries.map(({ embedding, ...rest }) => rest);
    res.json({ entries: clean });
  } catch (error) {
    console.error('Get entries error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/entries/:id', requireAuth, (req, res) => {
  try {
    const entries = loadJSON(getEntriesFile(req.session.userId));
    const entry = entries.find(e => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    const { embedding, ...clean } = entry;
    res.json({ entry: clean });
  } catch (error) {
    console.error('Get entry error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/entries/:id', requireAuth, (req, res) => {
  try {
    const { content, title } = req.body;
    const entries = loadJSON(getEntriesFile(req.session.userId));
    const index = entries.findIndex(e => e.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Entry not found' });

    if (content) {
      entries[index].content = content.trim();
      entries[index].embedding = getEmbedding(content);
    }
    if (title !== undefined) entries[index].title = title;
    entries[index].updatedAt = new Date().toISOString();

    saveJSON(getEntriesFile(req.session.userId), entries);
    const { embedding, ...clean } = entries[index];
    res.json({ entry: clean });
  } catch (error) {
    console.error('Update entry error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/entries/:id', requireAuth, (req, res) => {
  try {
    const entries = loadJSON(getEntriesFile(req.session.userId));
    const index = entries.findIndex(e => e.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Entry not found' });

    entries.splice(index, 1);
    saveJSON(getEntriesFile(req.session.userId), entries);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete entry error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ai-powered analysis endpoints

app.post('/api/analyze', requireAuth, async (req, res) => {
  try {
    const { content, entryId } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const systemPrompt = `You are a developer growth journal analyst. Analyze this journal entry from a software developer. Return JSON only:
{
  "mood": "one word mood (e.g. excited, frustrated, focused, anxious, confident, neutral)",
  "tags": ["3-5 relevant tags like debugging, learning, career, architecture, deployment"],
  "summary": "2-3 sentence summary of the key points",
  "encouragement": "A brief encouraging note specific to what they wrote about"
}`;

    const response = await groqChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content }
    ]);

    const analysis = safeParseJson(response);
    if (!analysis) {
      return res.status(500).json({ error: 'Failed to parse analysis' });
    }

    // persist analysis on the entry if we have an id
    if (entryId) {
      const entries = loadJSON(getEntriesFile(req.session.userId));
      const entry = entries.find(e => e.id === entryId);
      if (entry) {
        entry.mood = analysis.mood;
        entry.tags = analysis.tags;
        entry.summary = analysis.summary;
        entry.analyzedAt = new Date().toISOString();
        saveJSON(getEntriesFile(req.session.userId), entries);
      }
    }

    res.json({ analysis });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

app.post('/api/clarity', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const systemPrompt = `You are a thoughtful developer coach. Based on this journal entry, provide a brief reflection and 3 clarifying questions to help the developer think deeper. Return JSON only:
{
  "reflection": "A 2-3 sentence thoughtful reflection on what they wrote",
  "questions": ["question 1", "question 2", "question 3"]
}`;

    const response = await groqChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content }
    ]);

    const clarity = safeParseJson(response);
    if (!clarity) {
      return res.status(500).json({ error: 'Failed to parse clarity response' });
    }

    res.json({ clarity });
  } catch (error) {
    console.error('Clarity error:', error);
    res.status(500).json({ error: 'Clarity analysis failed' });
  }
});

// semantic search

app.post('/api/search', requireAuth, (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    const entries = loadJSON(getEntriesFile(req.session.userId));
    const queryEmbedding = getEmbedding(query);

    const results = entries
      .filter(e => e.embedding)
      .map(entry => ({
        id: entry.id,
        title: entry.title,
        content: entry.content.substring(0, 200) + (entry.content.length > 200 ? '...' : ''),
        createdAt: entry.createdAt,
        mood: entry.mood,
        tags: entry.tags,
        similarity: cosineSimilarity(queryEmbedding, entry.embedding)
      }))
      .filter(r => r.similarity > 0.1)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10);

    res.json({ results });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// reflections with rag (uses past entries for context)

app.post('/api/reflect', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const entries = loadJSON(getEntriesFile(req.session.userId));
    const queryEmbedding = getEmbedding(content);

    // grab the 5 most similar past entries for context
    const related = entries
      .filter(e => e.embedding)
      .map(entry => ({
        content: entry.content,
        mood: entry.mood,
        tags: entry.tags,
        date: entry.createdAt,
        similarity: cosineSimilarity(queryEmbedding, entry.embedding)
      }))
      .filter(r => r.similarity > 0.15)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    const contextStr = related.length > 0
      ? `\n\nRelated past entries:\n${related.map((r, i) => `[${i + 1}] (${new Date(r.date).toLocaleDateString()}, mood: ${r.mood || 'unknown'}): ${r.content.substring(0, 300)}`).join('\n')}`
      : '';

    const systemPrompt = `You are a developer growth coach with access to the developer's journal history. Based on their current entry and related past entries, provide a reflection that connects patterns and tracks growth. Return JSON only:
{
  "reflection": "A thoughtful 3-4 sentence reflection connecting current entry to past patterns",
  "patterns": ["pattern 1 you noticed", "pattern 2"],
  "growth": "One specific area where you see growth compared to earlier entries"
}`;

    const response = await groqChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Current entry: ${content}${contextStr}` }
    ], { temperature: 0.5 });

    const reflection = safeParseJson(response);
    if (!reflection) {
      return res.status(500).json({ error: 'Failed to parse reflection' });
    }

    res.json({
      reflection,
      relatedEntries: related.length
    });
  } catch (error) {
    console.error('Reflect error:', error);
    res.status(500).json({ error: 'Reflection failed' });
  }
});

// weekly recap

app.get('/api/recap', requireAuth, async (req, res) => {
  try {
    const entries = loadJSON(getEntriesFile(req.session.userId));
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const weekEntries = entries.filter(e => new Date(e.createdAt) >= oneWeekAgo);

    if (weekEntries.length === 0) {
      return res.json({ recap: { summary: 'No entries this week. Start journaling to get your weekly recap!', highlights: [], mood: 'N/A' } });
    }

    const entrySummaries = weekEntries.map(e =>
      `[${new Date(e.createdAt).toLocaleDateString()}] ${e.summary || e.content.substring(0, 200)}`
    ).join('\n');

    const systemPrompt = `You are a developer growth coach. Summarize this developer's week based on their journal entries. Return JSON only:
{
  "summary": "3-4 sentence overview of their week",
  "highlights": ["highlight 1", "highlight 2", "highlight 3"],
  "mood": "overall mood for the week",
  "focusAreas": ["what they focused on most"],
  "suggestion": "one thing to focus on next week"
}`;

    const response = await groqChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `This week's entries:\n${entrySummaries}` }
    ], { temperature: 0.5 });

    const recap = safeParseJson(response);
    if (!recap) {
      return res.status(500).json({ error: 'Failed to generate recap' });
    }

    res.json({ recap, entryCount: weekEntries.length });
  } catch (error) {
    console.error('Recap error:', error);
    res.status(500).json({ error: 'Recap failed' });
  }
});

// insights and trends

app.get('/api/insights/mood-trends', requireAuth, (req, res) => {
  try {
    const entries = loadJSON(getEntriesFile(req.session.userId));

    // only entries that have been through analysis have moods
    const moodEntries = entries
      .filter(e => e.mood)
      .map(e => ({
        date: e.createdAt,
        mood: e.mood
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const frequency = {};
    for (const entry of moodEntries) {
      const mood = entry.mood.toLowerCase();
      frequency[mood] = (frequency[mood] || 0) + 1;
    }

    res.json({
      timeline: moodEntries,
      frequency,
      total: moodEntries.length
    });
  } catch (error) {
    console.error('Mood trends error:', error);
    res.status(500).json({ error: 'Failed to load mood trends' });
  }
});

app.post('/api/insights/growth-patterns', requireAuth, async (req, res) => {
  try {
    const entries = loadJSON(getEntriesFile(req.session.userId));
    const analyzed = entries.filter(e => e.tags || e.mood || e.summary);

    if (analyzed.length < 2) {
      return res.json({
        patterns: {
          growthAreas: ['Not enough analyzed entries yet. Analyze more journal entries to detect growth patterns.'],
          blindSpots: [],
          recurringThemes: [],
          suggestion: 'Write and analyze at least 3-5 entries to start seeing patterns.'
        }
      });
    }

    const context = analyzed.map(e =>
      `[${new Date(e.createdAt).toLocaleDateString()}] mood: ${e.mood || 'unknown'}, tags: ${(e.tags || []).join(', ')}, summary: ${e.summary || e.content.substring(0, 200)}`
    ).join('\n');

    const systemPrompt = `You are a developer growth analyst. Analyze all of this developer's journal entries to identify long-term patterns. Return JSON only:
{
  "growthAreas": ["specific area where the developer has grown over time"],
  "blindSpots": ["recurring theme or issue the developer hasn't addressed"],
  "recurringThemes": ["theme that appears across many entries"],
  "suggestion": "one specific thing to journal about next based on the patterns you see"
}
Provide 2-3 items for each array. Be specific and reference actual patterns from their entries.`;

    const response = await groqChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `All journal entries:\n${context}` }
    ], { temperature: 0.7, max_tokens: 1024 });

    console.log('[growth-patterns] generated for', req.session.userId);

    const patterns = safeParseJson(response);
    if (!patterns) {
      return res.status(500).json({ error: 'Failed to parse growth patterns' });
    }

    res.json({ patterns });
  } catch (error) {
    console.error('Growth patterns error:', error);
    res.status(500).json({ error: 'Growth pattern analysis failed' });
  }
});

// streaming versions of ai endpoints

app.post('/api/stream/analyze', requireAuth, async (req, res) => {
  try {
    const { content, entryId } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const systemPrompt = `You are a developer growth journal analyst. Analyze this journal entry from a software developer. Return JSON only:
{
  "mood": "one word mood",
  "tags": ["3-5 relevant tags"],
  "summary": "2-3 sentence summary",
  "encouragement": "A brief encouraging note"
}`;

    const sse = initSSE(res);
    let full = '';
    try {
      for await (const token of groqChatStream([
        { role: 'system', content: systemPrompt },
        { role: 'user', content }
      ])) {
        full += token;
        sse.sendToken(token);
      }
    } catch (streamErr) {
      sse.error('Stream failed');
      return;
    }

    const analysis = safeParseJson(full);
    if (analysis) {
      if (entryId) {
        const entries = loadJSON(getEntriesFile(req.session.userId));
        const entry = entries.find(e => e.id === entryId);
        if (entry) {
          entry.mood = analysis.mood;
          entry.tags = analysis.tags;
          entry.summary = analysis.summary;
          entry.analyzedAt = new Date().toISOString();
          saveJSON(getEntriesFile(req.session.userId), entries);
        }
      }
      sse.sendJson({ parsed: analysis });
    }
    sse.done();
  } catch (error) {
    console.error('Stream analyze error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Analysis failed' });
  }
});

app.post('/api/stream/clarity', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const systemPrompt = `You are a thoughtful developer coach. Based on this journal entry, provide a brief reflection and 3 clarifying questions. Return JSON only:
{
  "reflection": "A 2-3 sentence thoughtful reflection",
  "questions": ["question 1", "question 2", "question 3"]
}`;

    const sse = initSSE(res);
    let full = '';
    try {
      for await (const token of groqChatStream([
        { role: 'system', content: systemPrompt },
        { role: 'user', content }
      ])) {
        full += token;
        sse.sendToken(token);
      }
    } catch (streamErr) {
      sse.error('Stream failed');
      return;
    }

    const clarity = safeParseJson(full);
    if (clarity) sse.sendJson({ parsed: clarity });
    sse.done();
  } catch (error) {
    console.error('Stream clarity error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Clarity failed' });
  }
});

app.post('/api/stream/reflect', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const entries = loadJSON(getEntriesFile(req.session.userId));
    const queryEmbedding = getEmbedding(content);

    const related = entries
      .filter(e => e.embedding)
      .map(entry => ({
        content: entry.content,
        mood: entry.mood,
        tags: entry.tags,
        date: entry.createdAt,
        similarity: cosineSimilarity(queryEmbedding, entry.embedding)
      }))
      .filter(r => r.similarity > 0.15)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    const contextStr = related.length > 0
      ? `\n\nRelated past entries:\n${related.map((r, i) => `[${i + 1}] (${new Date(r.date).toLocaleDateString()}, mood: ${r.mood || 'unknown'}): ${r.content.substring(0, 300)}`).join('\n')}`
      : '';

    const systemPrompt = `You are a developer growth coach with access to the developer's journal history. Based on their current entry and related past entries, provide a reflection that connects patterns and tracks growth. Return JSON only:
{
  "reflection": "A thoughtful 3-4 sentence reflection",
  "patterns": ["pattern 1", "pattern 2"],
  "growth": "One specific area of growth"
}`;

    const sse = initSSE(res);
    let full = '';
    try {
      for await (const token of groqChatStream([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Current entry: ${content}${contextStr}` }
      ], { temperature: 0.5 })) {
        full += token;
        sse.sendToken(token);
      }
    } catch (streamErr) {
      sse.error('Stream failed');
      return;
    }

    const reflection = safeParseJson(full);
    if (reflection) sse.sendJson({ parsed: reflection, relatedEntries: related.length });
    sse.done();
  } catch (error) {
    console.error('Stream reflect error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Reflection failed' });
  }
});

// ai coach — multi-turn chat with journal context

function buildCoachContext(userId) {
  const entries = loadJSON(getEntriesFile(userId));
  const sorted = [...entries].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const recent = sorted.slice(0, 10);

  let context = '';
  if (recent.length > 0) {
    context += 'Recent journal entries:\n';
    context += recent.map(e =>
      `[${new Date(e.createdAt).toLocaleDateString()}] mood: ${e.mood || 'unknown'} | ${e.content.substring(0, 200)}`
    ).join('\n');
  }
  return context;
}

function buildCoachContextWithRAG(userId, lastUserMessage) {
  let context = buildCoachContext(userId);

  if (lastUserMessage) {
    const entries = loadJSON(getEntriesFile(userId));
    const queryEmbedding = getEmbedding(lastUserMessage);
    const relevant = entries
      .filter(e => e.embedding)
      .map(e => ({ ...e, similarity: cosineSimilarity(queryEmbedding, e.embedding) }))
      .filter(r => r.similarity > 0.15)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);

    if (relevant.length > 0) {
      context += '\n\nSemantically relevant entries:\n';
      context += relevant.map(e =>
        `[${new Date(e.createdAt).toLocaleDateString()}] ${e.content.substring(0, 200)}`
      ).join('\n');
    }
  }
  return context;
}

const COACH_SYSTEM = (context) => `You are ClearMind Coach, an empathetic AI developer growth coach. You have access to this developer's journal history.

${context}

Reference specific entries by date/topic when relevant. Be warm but direct. Ask follow-up questions. Notice patterns. Keep responses 2-4 paragraphs.`;

app.post('/api/coach', requireAuth, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const context = buildCoachContextWithRAG(req.session.userId, lastUserMsg?.content);
    const trimmed = messages.slice(-20);

    const response = await groqChat([
      { role: 'system', content: COACH_SYSTEM(context) },
      ...trimmed
    ], { temperature: 0.7, max_tokens: 1024 });

    res.json({ response });
  } catch (error) {
    console.error('Coach error:', error);
    res.status(500).json({ error: 'Coach failed' });
  }
});

app.post('/api/stream/coach', requireAuth, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const context = buildCoachContextWithRAG(req.session.userId, lastUserMsg?.content);
    const trimmed = messages.slice(-20);

    const sse = initSSE(res);
    let full = '';
    try {
      for await (const token of groqChatStream([
        { role: 'system', content: COACH_SYSTEM(context) },
        ...trimmed
      ], { temperature: 0.7, max_tokens: 1024 })) {
        full += token;
        sse.sendToken(token);
      }
    } catch (streamErr) {
      sse.error('Stream failed');
      return;
    }

    sse.sendJson({ response: full });
    sse.done();
  } catch (error) {
    console.error('Stream coach error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Coach failed' });
  }
});

// personalized writing prompts

app.get('/api/prompts', requireAuth, async (req, res) => {
  try {
    const entries = loadJSON(getEntriesFile(req.session.userId));
    const sorted = [...entries].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const recent = sorted.slice(0, 15);

    if (recent.length === 0) {
      return res.json({
        prompts: [
          { text: 'What challenge are you working through right now?', category: 'Reflection' },
          { text: 'Describe a recent win — big or small.', category: 'Wins' },
          { text: 'What is one thing you want to focus on this week and why?', category: 'Goals' },
        ]
      });
    }

    const tags = {};
    const moods = [];
    const summaries = [];
    for (const e of recent) {
      if (e.tags) e.tags.forEach(t => { tags[t] = (tags[t] || 0) + 1; });
      if (e.mood) moods.push(e.mood);
      summaries.push(e.summary || e.content.substring(0, 150));
    }

    const topTags = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
    const recentMoods = moods.slice(0, 5);

    const systemPrompt = `Generate 3 personalized journal prompts for a developer. Their recent topics: ${topTags.join(', ')}. Recent moods: ${recentMoods.join(', ')}. Recent summaries: ${summaries.slice(0, 5).join(' | ')}

Suggest prompts that explore areas NOT already covered. Return JSON only:
[
  { "text": "prompt question", "category": "one-word category" },
  { "text": "prompt question", "category": "one-word category" },
  { "text": "prompt question", "category": "one-word category" }
]`;

    const response = await groqChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Generate prompts' }
    ], { temperature: 0.8, max_tokens: 512 });

    const parsed = safeParseJson(response);
    if (!parsed || !Array.isArray(parsed)) {
      return res.json({
        prompts: [
          { text: 'What challenge are you working through right now?', category: 'Reflection' },
          { text: 'Describe a recent win — big or small.', category: 'Wins' },
          { text: 'What is one thing you want to focus on this week and why?', category: 'Goals' },
        ]
      });
    }

    res.json({ prompts: parsed.slice(0, 3) });
  } catch (error) {
    console.error('Prompts error:', error);
    res.status(500).json({ error: 'Failed to generate prompts' });
  }
});

// time capsule — compare your past and present

app.post('/api/time-capsule', requireAuth, async (req, res) => {
  try {
    const { daysAgo } = req.body;
    if (!daysAgo || daysAgo <= 0) {
      return res.status(400).json({ error: 'daysAgo is required and must be > 0' });
    }

    const entries = loadJSON(getEntriesFile(req.session.userId));
    const now = new Date();
    const weekMs = 7 * 24 * 60 * 60 * 1000;

    const recentEntries = entries.filter(e => {
      const d = new Date(e.createdAt);
      return (now - d) <= weekMs;
    });

    const pastCenter = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
    const pastStart = new Date(pastCenter - weekMs / 2);
    const pastEnd = new Date(pastCenter.getTime() + weekMs / 2);
    const pastEntries = entries.filter(e => {
      const d = new Date(e.createdAt);
      return d >= pastStart && d <= pastEnd;
    });

    if (recentEntries.length === 0 && pastEntries.length === 0) {
      return res.json({
        empty: true,
        narrative: 'Not enough entries to compare yet. Keep journaling and check back!',
        then: { period: `${daysAgo} days ago`, entries: 0 },
        now: { period: 'This week', entries: 0 },
      });
    }

    const formatEntries = (arr) => arr.map(e =>
      `[${new Date(e.createdAt).toLocaleDateString()}] mood: ${e.mood || 'unknown'} | ${e.summary || e.content.substring(0, 200)}`
    ).join('\n');

    const systemPrompt = `Compare two periods of a developer's journal. "Then" is from ${daysAgo} days ago, "Now" is the past week. Return JSON only:
{
  "narrative": "3-5 sentence second-person growth story",
  "changes": ["specific change 1", "specific change 2", "specific change 3"],
  "constants": ["consistent thing 1", "consistent thing 2"],
  "moodShift": "how emotional patterns changed",
  "advice": "forward-looking suggestion"
}`;

    const response = await groqChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `THEN (${daysAgo} days ago):\n${formatEntries(pastEntries) || 'No entries'}\n\nNOW (this week):\n${formatEntries(recentEntries) || 'No entries'}` }
    ], { temperature: 0.6, max_tokens: 1024 });

    const capsule = safeParseJson(response);
    if (!capsule) {
      return res.status(500).json({ error: 'Failed to parse time capsule' });
    }

    res.json({
      ...capsule,
      then: { period: `${daysAgo} days ago`, entries: pastEntries.length },
      now: { period: 'This week', entries: recentEntries.length },
    });
  } catch (error) {
    console.error('Time capsule error:', error);
    res.status(500).json({ error: 'Time capsule failed' });
  }
});

// lets the user save their groq api key from the settings banner
app.post('/api/settings/api-key', requireAuth, (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || !apiKey.trim()) {
      return res.status(400).json({ error: 'API key is required' });
    }

    const config = loadConfig();
    config.groqApiKey = apiKey.trim();
    saveConfig(config);

    // swap the groq client to use the new key
    groq = new Groq({ apiKey: apiKey.trim() });

    res.json({ success: true });
  } catch (error) {
    console.error('Save API key error:', error);
    res.status(500).json({ error: 'Failed to save API key' });
  }
});

// quick check so the frontend knows whether to show the setup banner
app.get('/api/settings/has-key', requireAuth, (req, res) => {
  const config = loadConfig();
  const envKey = process.env.GROQ_API_KEY || '';
  const hasKey = !!(config.groqApiKey || envKey);
  res.json({ hasKey });
});

// on startup, load any saved key from config
(function loadSavedApiKey() {
  try {
    const config = loadConfig();
    if (config.groqApiKey) {
      groq = new Groq({ apiKey: config.groqApiKey });
    }
  } catch {}
})();

// boot the server

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`ClearMindAI running at http://localhost:${PORT}`);
  });
}

export default app;
