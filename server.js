// ClearMindAI server — Express backend for a personal growth journaling app
// with AI-powered analysis, coaching, and growth tracking via Groq LLMs

import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import bcrypt from 'bcryptjs';
import Groq from 'groq-sdk';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import {
  getPool, initDB,
  findUserByEmail, createUser, findUserById, setUserApiKey, getUserApiKey,
  getUserLlmProvider, setUserLlmProvider,
  createEntry as dbCreateEntry, getEntries as dbGetEntries, getEntryById as dbGetEntryById,
  updateEntry as dbUpdateEntry, deleteEntry as dbDeleteEntry,
  getEntriesWithEmbeddings, getEntriesInDateRange, getAnalyzedEntries,
  updateEntryAnalysis,
  findUserByAzureOid, createUserFromAzure,
} from './db.js';
import { runAgent, streamAgent, getAgentStatus, AGENT_LABELS } from './agents/index.js';
import {
  getEmbedding as _getEmbedding,
  cosineSimilarity as _cosineSimilarity,
  safeParseJson as _safeParseJson,
} from './utils.js';

// Re-export for backward compatibility (used by tests)
export const getEmbedding = _getEmbedding;
export const cosineSimilarity = _cosineSimilarity;
export const safeParseJson = _safeParseJson;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Per-request Groq client using the calling user's API key
function makeGroqClient(apiKey) {
  return new Groq({ apiKey: apiKey || '' });
}

// swappable for tests since groq-sdk has its own http client
let _groqChat = async (messages, options = {}) => {
  const groq = makeGroqClient(options._apiKey);
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
  const groq = makeGroqClient(options._apiKey);
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

// resolves the API key for the current request (per-user BYOK or env fallback)
async function resolveApiKey(userId) {
  const userKey = await getUserApiKey(userId);
  return userKey || process.env.GROQ_API_KEY || '';
}

// resolves the full AI config for the current request (provider + API key)
async function resolveAIConfig(userId) {
  const provider = await getUserLlmProvider(userId);
  const apiKey = await resolveApiKey(userId);
  return { provider, apiKey };
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

// trust proxy in production (Render terminates TLS at load balancer)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// session store — Postgres-backed in production, memory in dev/test
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'clearmind-dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
};

if (process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
  const PgSession = connectPgSimple(session);
  sessionConfig.store = new PgSession({
    pool: getPool(),
    createTableIfMissing: true,
  });
}

app.use(session(sessionConfig));

// --- Azure AD auth (feature-flagged) ---
const ENABLE_AZURE_AUTH = process.env.ENABLE_AZURE_AUTH === 'true';

if (ENABLE_AZURE_AUTH) {
  const { azureAuthMiddleware } = await import('./microsoft/auth.js');
  app.use(azureAuthMiddleware);
}

/**
 * Resolves an Azure AD user to a local user ID.
 * Auto-provisions a local account on first authentication.
 */
async function resolveAzureUserToLocal(azureUser) {
  let user = await findUserByAzureOid(azureUser.oid);
  if (!user) {
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    user = await createUserFromAzure({
      id,
      email: azureUser.email || `${azureUser.oid}@azure`,
      name: azureUser.name,
      azureOid: azureUser.oid,
    });
  }
  return user.id;
}

// getEmbedding, cosineSimilarity, safeParseJson — see utils.js

export async function groqChat(messages, options = {}) {
  return _groqChat(messages, options);
}

async function requireAuth(req, res, next) {
  // Path 1: Session auth (existing web UI)
  if (req.session.userId) {
    req.authUserId = req.session.userId;
    return next();
  }
  // Path 2: Azure AD Bearer (Copilot Studio / Power Automate)
  if (req.azureUser) {
    try {
      req.authUserId = await resolveAzureUserToLocal(req.azureUser);
      return next();
    } catch (err) {
      console.error('Azure user resolution failed:', err);
      return res.status(500).json({ error: 'Failed to resolve Azure user' });
    }
  }
  return res.status(401).json({ error: 'Not authenticated' });
}

// health check for Render
app.get('/health', (req, res) => res.json({ status: 'ok' }));

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

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const user = await createUser({
      id,
      email,
      name: name || email.split('@')[0],
      password: hashedPassword,
    });

    req.session.userId = user.id;
    res.json({ user: { id: user.id, email: user.email, name: user.name, createdAt: user.created_at } });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await findUserByEmail(email);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.userId = user.id;
    res.json({ user: { id: user.id, email: user.email, name: user.name, createdAt: user.created_at } });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  const user = await findUserById(req.session.userId);
  if (!user) return res.json({ user: null });
  res.json({ user: { id: user.id, email: user.email, name: user.name, createdAt: user.created_at } });
});

app.post('/api/auth/signout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// journal entries crud

app.post('/api/entries', requireAuth, async (req, res) => {
  try {
    const { content, title } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const entry = await dbCreateEntry({
      id,
      userId: req.authUserId,
      title: title || 'Untitled Entry',
      content: content.trim(),
      embedding: getEmbedding(content),
    });

    res.json({ entry });
  } catch (error) {
    console.error('Create entry error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/entries', requireAuth, async (req, res) => {
  try {
    const entries = await dbGetEntries(req.authUserId);
    res.json({ entries });
  } catch (error) {
    console.error('Get entries error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/entries/:id', requireAuth, async (req, res) => {
  try {
    const entry = await dbGetEntryById(req.authUserId, req.params.id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json({ entry });
  } catch (error) {
    console.error('Get entry error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/entries/:id', requireAuth, async (req, res) => {
  try {
    const { content, title } = req.body;
    const updates = {};
    if (content) {
      updates.content = content.trim();
      updates.embedding = getEmbedding(content);
    }
    if (title !== undefined) updates.title = title;

    const entry = await dbUpdateEntry(req.authUserId, req.params.id, updates);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json({ entry });
  } catch (error) {
    console.error('Update entry error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/entries/:id', requireAuth, async (req, res) => {
  try {
    const deleted = await dbDeleteEntry(req.authUserId, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Entry not found' });
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

    const { provider, apiKey } = await resolveAIConfig(req.authUserId);
    const response = await runAgent('mood_analyst', content, {
      userId: req.authUserId, apiKey, provider,
    });

    const analysis = safeParseJson(response);
    if (!analysis) {
      return res.status(500).json({ error: 'Failed to parse analysis' });
    }

    // persist analysis on the entry if we have an id
    if (entryId) {
      await updateEntryAnalysis(req.authUserId, entryId, {
        mood: analysis.mood,
        tags: analysis.tags,
        summary: analysis.summary,
      });
    }

    res.json({ analysis, agent: 'Mood Analyst' });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

app.post('/api/clarity', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const { provider, apiKey } = await resolveAIConfig(req.authUserId);
    const response = await runAgent('clarity_coach', content, {
      userId: req.authUserId, apiKey, provider,
    });

    const clarity = safeParseJson(response);
    if (!clarity) {
      return res.status(500).json({ error: 'Failed to parse clarity response' });
    }

    res.json({ clarity, agent: 'Clarity Coach' });
  } catch (error) {
    console.error('Clarity error:', error);
    res.status(500).json({ error: 'Clarity analysis failed' });
  }
});

// semantic search

app.post('/api/search', requireAuth, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    const entries = await getEntriesWithEmbeddings(req.authUserId);
    const queryEmbedding = getEmbedding(query);

    const results = entries
      .map(entry => ({
        id: entry.id,
        title: entry.title,
        content: entry.content.substring(0, 200) + (entry.content.length > 200 ? '...' : ''),
        createdAt: entry.created_at,
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

    // Build RAG context (keep for context count) + delegate to ADK agent
    const entries = await getEntriesWithEmbeddings(req.authUserId);
    const queryEmbedding = getEmbedding(content);

    const related = entries
      .map(entry => ({
        content: entry.content,
        mood: entry.mood,
        date: entry.created_at,
        similarity: cosineSimilarity(queryEmbedding, entry.embedding)
      }))
      .filter(r => r.similarity > 0.15)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    const contextStr = related.length > 0
      ? `\n\nRelated past entries:\n${related.map((r, i) => `[${i + 1}] (${new Date(r.date).toLocaleDateString()}, mood: ${r.mood || 'unknown'}): ${r.content.substring(0, 300)}`).join('\n')}`
      : '';

    const { provider, apiKey } = await resolveAIConfig(req.authUserId);
    const response = await runAgent('reflector', `Current entry: ${content}${contextStr}`, {
      userId: req.authUserId, apiKey, provider,
    });

    const reflection = safeParseJson(response);
    if (!reflection) {
      return res.status(500).json({ error: 'Failed to parse reflection' });
    }

    res.json({
      reflection,
      relatedEntries: related.length,
      agent: 'Reflector',
    });
  } catch (error) {
    console.error('Reflect error:', error);
    res.status(500).json({ error: 'Reflection failed' });
  }
});

// weekly recap

app.get('/api/recap', requireAuth, async (req, res) => {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weekEntries = await getEntriesInDateRange(req.authUserId, oneWeekAgo, new Date());

    if (weekEntries.length === 0) {
      return res.json({ recap: { summary: 'No entries this week. Start journaling to get your weekly recap!', highlights: [], mood: 'N/A' } });
    }

    const entrySummaries = weekEntries.map(e =>
      `[${new Date(e.created_at).toLocaleDateString()}] ${e.summary || e.content.substring(0, 200)}`
    ).join('\n');

    const { provider, apiKey } = await resolveAIConfig(req.authUserId);
    const response = await runAgent('recap_writer', `This week's entries:\n${entrySummaries}`, {
      userId: req.authUserId, apiKey, provider,
    });

    const recap = safeParseJson(response);
    if (!recap) {
      return res.status(500).json({ error: 'Failed to generate recap' });
    }

    res.json({ recap, entryCount: weekEntries.length, agent: 'Recap Writer' });
  } catch (error) {
    console.error('Recap error:', error);
    res.status(500).json({ error: 'Recap failed' });
  }
});

// insights and trends

app.get('/api/insights/mood-trends', requireAuth, async (req, res) => {
  try {
    const entries = await dbGetEntries(req.authUserId);

    // only entries that have been through analysis have moods
    const moodEntries = entries
      .filter(e => e.mood)
      .map(e => ({
        date: e.created_at,
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
    const analyzed = await getAnalyzedEntries(req.authUserId);

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
      `[${new Date(e.created_at).toLocaleDateString()}] mood: ${e.mood || 'unknown'}, tags: ${(e.tags || []).join(', ')}, summary: ${e.summary || e.content.substring(0, 200)}`
    ).join('\n');

    const { provider, apiKey } = await resolveAIConfig(req.authUserId);
    const response = await runAgent('growth_analyst', `All journal entries:\n${context}`, {
      userId: req.authUserId, apiKey, provider,
    });

    const patterns = safeParseJson(response);
    if (!patterns) {
      return res.status(500).json({ error: 'Failed to parse growth patterns' });
    }

    res.json({ patterns, agent: 'Growth Analyst' });
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

    const { provider, apiKey } = await resolveAIConfig(req.authUserId);
    const sse = initSSE(res);
    let full = '';
    try {
      for await (const token of streamAgent('mood_analyst', content, {
        userId: req.authUserId, apiKey, provider,
      })) {
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
        await updateEntryAnalysis(req.authUserId, entryId, {
          mood: analysis.mood,
          tags: analysis.tags,
          summary: analysis.summary,
        });
      }
      sse.sendJson({ parsed: analysis, agent: 'Mood Analyst' });
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

    const { provider, apiKey } = await resolveAIConfig(req.authUserId);
    const sse = initSSE(res);
    let full = '';
    try {
      for await (const token of streamAgent('clarity_coach', content, {
        userId: req.authUserId, apiKey, provider,
      })) {
        full += token;
        sse.sendToken(token);
      }
    } catch (streamErr) {
      sse.error('Stream failed');
      return;
    }

    const clarity = safeParseJson(full);
    if (clarity) sse.sendJson({ parsed: clarity, agent: 'Clarity Coach' });
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

    const entries = await getEntriesWithEmbeddings(req.authUserId);
    const queryEmbedding = getEmbedding(content);

    const related = entries
      .map(entry => ({
        content: entry.content,
        mood: entry.mood,
        date: entry.created_at,
        similarity: cosineSimilarity(queryEmbedding, entry.embedding)
      }))
      .filter(r => r.similarity > 0.15)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    const contextStr = related.length > 0
      ? `\n\nRelated past entries:\n${related.map((r, i) => `[${i + 1}] (${new Date(r.date).toLocaleDateString()}, mood: ${r.mood || 'unknown'}): ${r.content.substring(0, 300)}`).join('\n')}`
      : '';

    const { provider, apiKey } = await resolveAIConfig(req.authUserId);
    const sse = initSSE(res);
    let full = '';
    try {
      for await (const token of streamAgent('reflector', `Current entry: ${content}${contextStr}`, {
        userId: req.authUserId, apiKey, provider,
      })) {
        full += token;
        sse.sendToken(token);
      }
    } catch (streamErr) {
      sse.error('Stream failed');
      return;
    }

    const reflection = safeParseJson(full);
    if (reflection) sse.sendJson({ parsed: reflection, relatedEntries: related.length, agent: 'Reflector' });
    sse.done();
  } catch (error) {
    console.error('Stream reflect error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Reflection failed' });
  }
});

// ai coach — multi-turn chat with journal context

async function buildCoachContext(userId) {
  const entries = await dbGetEntries(userId);
  const recent = entries.slice(0, 10);

  let context = '';
  if (recent.length > 0) {
    context += 'Recent journal entries:\n';
    context += recent.map(e =>
      `[${new Date(e.created_at).toLocaleDateString()}] mood: ${e.mood || 'unknown'} | ${e.content.substring(0, 200)}`
    ).join('\n');
  }
  return context;
}

async function buildCoachContextWithRAG(userId, lastUserMessage) {
  let context = await buildCoachContext(userId);

  if (lastUserMessage) {
    const entries = await getEntriesWithEmbeddings(userId);
    const queryEmbedding = getEmbedding(lastUserMessage);
    const relevant = entries
      .map(e => ({ ...e, similarity: cosineSimilarity(queryEmbedding, e.embedding) }))
      .filter(r => r.similarity > 0.15)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);

    if (relevant.length > 0) {
      context += '\n\nSemantically relevant entries:\n';
      context += relevant.map(e =>
        `[${new Date(e.created_at).toLocaleDateString()}] ${e.content.substring(0, 200)}`
      ).join('\n');
    }
  }
  return context;
}

const COACH_SYSTEM = (context) => `You are ClearMind Coach, an empathetic AI growth coach. You have access to this person's journal history.

${context}

Reference specific entries by date/topic when relevant. Be warm but direct. Ask follow-up questions. Notice patterns. Keep responses 2-4 paragraphs.`;

app.post('/api/coach', requireAuth, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const context = await buildCoachContextWithRAG(req.authUserId, lastUserMsg?.content);
    const trimmed = messages.slice(-20);

    // Build a combined message with context for the ADK agent
    const contextualMessage = `[Context: ${context}]\n\nConversation:\n${trimmed.map(m => `${m.role}: ${m.content}`).join('\n')}`;

    const { provider, apiKey } = await resolveAIConfig(req.authUserId);
    const response = await runAgent('coach', contextualMessage, {
      userId: req.authUserId, apiKey, provider,
    });

    res.json({ response, agent: 'Coach' });
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
    const context = await buildCoachContextWithRAG(req.authUserId, lastUserMsg?.content);
    const trimmed = messages.slice(-20);

    const contextualMessage = `[Context: ${context}]\n\nConversation:\n${trimmed.map(m => `${m.role}: ${m.content}`).join('\n')}`;

    const { provider, apiKey } = await resolveAIConfig(req.authUserId);
    const sse = initSSE(res);
    let full = '';
    try {
      for await (const token of streamAgent('coach', contextualMessage, {
        userId: req.authUserId, apiKey, provider,
      })) {
        full += token;
        sse.sendToken(token);
      }
    } catch (streamErr) {
      sse.error('Stream failed');
      return;
    }

    sse.sendJson({ response: full, agent: 'Coach' });
    sse.done();
  } catch (error) {
    console.error('Stream coach error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Coach failed' });
  }
});

// personalized writing prompts

app.get('/api/prompts', requireAuth, async (req, res) => {
  try {
    const entries = await dbGetEntries(req.authUserId);
    const recent = entries.slice(0, 15);

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

    const apiKey = await resolveApiKey(req.authUserId);
    const systemPrompt = `Generate 3 personalized journal prompts for a university student or recent graduate. Their recent topics: ${topTags.join(', ')}. Recent moods: ${recentMoods.join(', ')}. Recent summaries: ${summaries.slice(0, 5).join(' | ')}

Suggest prompts that explore areas NOT already covered. Return JSON only:
[
  { "text": "prompt question", "category": "one-word category" },
  { "text": "prompt question", "category": "one-word category" },
  { "text": "prompt question", "category": "one-word category" }
]`;

    const response = await groqChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Generate prompts' }
    ], { temperature: 0.8, max_tokens: 512, _apiKey: apiKey });

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

    const now = new Date();
    const weekMs = 7 * 24 * 60 * 60 * 1000;

    const recentEntries = await getEntriesInDateRange(
      req.authUserId,
      new Date(now - weekMs),
      now
    );

    const pastCenter = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
    const pastStart = new Date(pastCenter - weekMs / 2);
    const pastEnd = new Date(pastCenter.getTime() + weekMs / 2);
    const pastEntries = await getEntriesInDateRange(req.authUserId, pastStart, pastEnd);

    if (recentEntries.length === 0 && pastEntries.length === 0) {
      return res.json({
        empty: true,
        narrative: 'Not enough entries to compare yet. Keep journaling and check back!',
        then: { period: `${daysAgo} days ago`, entries: 0 },
        now: { period: 'This week', entries: 0 },
      });
    }

    const formatEntries = (arr) => arr.map(e =>
      `[${new Date(e.created_at).toLocaleDateString()}] mood: ${e.mood || 'unknown'} | ${e.summary || e.content.substring(0, 200)}`
    ).join('\n');

    const apiKey = await resolveApiKey(req.authUserId);
    const systemPrompt = `Compare two periods of a person's journal. "Then" is from ${daysAgo} days ago, "Now" is the past week. Return JSON only:
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
    ], { temperature: 0.6, max_tokens: 1024, _apiKey: apiKey });

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

// export — shared markdown formatter

function formatEntryToMarkdown(entry) {
  const date = new Date(entry.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  let md = `## ${entry.title || 'Untitled Entry'}\n`;
  md += `**Date:** ${date}`;
  if (entry.mood) md += ` | **Mood:** ${entry.mood}`;
  if (entry.tags && entry.tags.length) md += ` | **Tags:** ${entry.tags.join(', ')}`;
  md += '\n\n';
  md += entry.content + '\n';
  if (entry.summary) md += `\n> **AI Summary:** ${entry.summary}\n`;
  md += '\n---\n\n';
  return md;
}

// export — fetch entries by scope helper

async function getExportEntries(userId, scope, { start, end, id } = {}) {
  if (scope === 'entry' && id) {
    const entry = await dbGetEntryById(userId, id);
    return entry ? [entry] : null;
  }
  if (scope === 'range' && start && end) {
    return getEntriesInDateRange(userId, new Date(start), new Date(end));
  }
  return dbGetEntries(userId);
}

// POST /api/export/summary — AI summary for a custom date range

app.post('/api/export/summary', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    let entries;
    if (startDate && endDate) {
      entries = await getEntriesInDateRange(req.authUserId, new Date(startDate), new Date(endDate));
    } else {
      entries = await dbGetEntries(req.authUserId);
    }

    if (!entries || entries.length === 0) {
      return res.json({ summary: { overview: 'No entries found for the selected period.', themes: [], moodJourney: '', growthNarrative: '', notableEntries: [] } });
    }

    const context = entries.map(e => formatEntryToMarkdown(e)).join('');

    const apiKey = await resolveApiKey(req.authUserId);
    const systemPrompt = `You are a personal growth journal analyst. Summarize the following journal entries into a structured report. Return JSON only:
{
  "overview": "3-5 sentence overview of the period",
  "themes": ["key theme 1", "key theme 2", "key theme 3"],
  "moodJourney": "2-3 sentences describing the emotional arc",
  "growthNarrative": "2-3 sentences about personal growth observed",
  "notableEntries": ["brief description of standout entry 1", "brief description of standout entry 2"]
}`;

    const response = await groqChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: context }
    ], { temperature: 0.5, max_tokens: 1024, _apiKey: apiKey });

    const summary = safeParseJson(response);
    if (!summary) {
      return res.status(500).json({ error: 'Failed to generate summary' });
    }

    res.json({ summary, entryCount: entries.length });
  } catch (error) {
    console.error('Export summary error:', error);
    res.status(500).json({ error: 'Summary generation failed' });
  }
});

// GET /api/export/markdown — download entries as .md

app.get('/api/export/markdown', requireAuth, async (req, res) => {
  try {
    const { scope = 'all', start, end, id, includeSummary } = req.query;
    const entries = await getExportEntries(req.authUserId, scope, { start, end, id });

    if (!entries || entries.length === 0) {
      return res.status(404).json({ error: 'No entries found' });
    }

    const user = await findUserById(req.authUserId);
    const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    let md = `---\ntitle: ClearMindAI Journal Export\nauthor: ${user?.name || 'Journal User'}\ndate: ${now}\nentries: ${entries.length}\n---\n\n`;
    md += `# ClearMindAI Journal Export\n\n`;

    if (includeSummary === 'true' && entries.length > 1) {
      try {
        const context = entries.map(e => formatEntryToMarkdown(e)).join('');
        const apiKey = await resolveApiKey(req.authUserId);
        const summaryResponse = await groqChat([
          { role: 'system', content: 'Summarize these journal entries in 3-5 sentences. Return plain text, no JSON.' },
          { role: 'user', content: context }
        ], { temperature: 0.5, max_tokens: 512, _apiKey: apiKey });
        md += `## AI Summary\n\n${summaryResponse}\n\n---\n\n`;
      } catch {
        // skip summary on error
      }
    }

    for (const entry of entries) {
      md += formatEntryToMarkdown(entry);
    }

    const filename = scope === 'entry' ? `journal-entry-${id}.md` : `journal-export-${Date.now()}.md`;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(md);
  } catch (error) {
    console.error('Markdown export error:', error);
    res.status(500).json({ error: 'Markdown export failed' });
  }
});

// GET /api/export/pdf — download entries as styled PDF

app.get('/api/export/pdf', requireAuth, async (req, res) => {
  try {
    const { scope = 'all', start, end, id, includeSummary } = req.query;
    const entries = await getExportEntries(req.authUserId, scope, { start, end, id });

    if (!entries || entries.length === 0) {
      return res.status(404).json({ error: 'No entries found' });
    }

    const user = await findUserById(req.authUserId);
    const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const doc = new PDFDocument({ margin: 60, size: 'A4' });

    const filename = scope === 'entry' ? `journal-entry-${id}.pdf` : `journal-export-${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // cover page
    doc.moveDown(6);
    doc.fontSize(28).fillColor('#8b6f4e').text('ClearMindAI', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(18).fillColor('#1a1612').text('Journal Export', { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(12).fillColor('#a89b8e').text(user?.name || 'Journal User', { align: 'center' });
    doc.text(`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`, { align: 'center' });
    doc.text(`Exported ${now}`, { align: 'center' });

    // AI summary page (if requested)
    if (includeSummary === 'true' && entries.length > 1) {
      try {
        const context = entries.map(e => formatEntryToMarkdown(e)).join('');
        const apiKey = await resolveApiKey(req.authUserId);
        const summaryText = await groqChat([
          { role: 'system', content: 'Summarize these journal entries in 3-5 sentences. Return plain text, no JSON.' },
          { role: 'user', content: context }
        ], { temperature: 0.5, max_tokens: 512, _apiKey: apiKey });

        doc.addPage();
        doc.fontSize(16).fillColor('#8b6f4e').text('AI Summary', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor('#1a1612').text(summaryText, { lineGap: 4 });
      } catch {
        // skip summary on error
      }
    }

    // entry pages
    for (const entry of entries) {
      doc.addPage();
      doc.fontSize(16).fillColor('#8b6f4e').text(entry.title || 'Untitled Entry');
      doc.moveDown(0.3);

      const date = new Date(entry.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      let meta = date;
      if (entry.mood) meta += `  •  ${entry.mood}`;
      if (entry.tags && entry.tags.length) meta += `  •  ${entry.tags.join(', ')}`;
      doc.fontSize(9).fillColor('#a89b8e').text(meta);
      doc.moveDown(0.5);

      doc.fontSize(11).fillColor('#1a1612').text(entry.content, { lineGap: 4 });

      if (entry.summary) {
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#a89b8e').text(`AI Summary: ${entry.summary}`, { lineGap: 3 });
      }

      doc.moveDown(1);
      doc.moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y).strokeColor('#e0d5c8').stroke();
    }

    doc.end();
  } catch (error) {
    console.error('PDF export error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'PDF export failed' });
  }
});

// per-user api key management (BYOK)
app.post('/api/settings/api-key', requireAuth, async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || !apiKey.trim()) {
      return res.status(400).json({ error: 'API key is required' });
    }

    await setUserApiKey(req.authUserId, apiKey.trim());
    res.json({ success: true });
  } catch (error) {
    console.error('Save API key error:', error);
    res.status(500).json({ error: 'Failed to save API key' });
  }
});

// quick check so the frontend knows whether to show the setup banner
app.get('/api/settings/has-key', requireAuth, async (req, res) => {
  const userKey = await getUserApiKey(req.authUserId);
  const envKey = process.env.GROQ_API_KEY || '';
  const hasKey = !!(userKey || envKey);
  res.json({ hasKey });
});

// llm provider settings
app.get('/api/settings/llm-provider', requireAuth, async (req, res) => {
  const provider = await getUserLlmProvider(req.authUserId);
  res.json({ provider });
});

app.post('/api/settings/llm-provider', requireAuth, async (req, res) => {
  try {
    const { provider, apiKey } = req.body;
    if (!provider || !['groq', 'gemini'].includes(provider)) {
      return res.status(400).json({ error: 'Provider must be "groq" or "gemini"' });
    }
    await setUserLlmProvider(req.authUserId, provider);
    if (apiKey) {
      await setUserApiKey(req.authUserId, apiKey.trim());
    }
    res.json({ success: true, provider });
  } catch (error) {
    console.error('Set LLM provider error:', error);
    res.status(500).json({ error: 'Failed to update LLM provider' });
  }
});

// adk agents status
app.get('/api/agents/status', requireAuth, async (req, res) => {
  const provider = await getUserLlmProvider(req.authUserId);
  res.json(getAgentStatus(provider));
});

// --- Microsoft Graph calendar context (feature-flagged) ---

if (process.env.ENABLE_GRAPH_INTEGRATION === 'true') {
  const { getUserCalendarEvents, getUserPresence, formatCalendarContext } = await import('./microsoft/graph.js');

  app.get('/api/context/calendar', requireAuth, async (req, res) => {
    try {
      if (!req.azureUser) {
        return res.status(400).json({ error: 'Calendar context requires Azure AD authentication' });
      }
      const events = await getUserCalendarEvents(req.azureUser.oid);
      const presence = await getUserPresence(req.azureUser.oid);
      res.json({
        events,
        presence,
        formatted: formatCalendarContext(events, presence),
      });
    } catch (error) {
      console.error('Calendar context error:', error);
      res.status(500).json({ error: 'Failed to fetch calendar context' });
    }
  });
}

// --- Dataverse sync endpoints (feature-flagged) ---

if (process.env.ENABLE_DATAVERSE_SYNC === 'true') {
  const { syncEntryToDataverse } = await import('./microsoft/dataverse.js');
  const { getUnsyncedEntries, markEntrySynced } = await import('./db.js');

  app.post('/api/dataverse/sync', requireAuth, async (req, res) => {
    try {
      const unsynced = await getUnsyncedEntries(req.authUserId);
      const results = { synced: 0, errors: [] };

      for (const entry of unsynced) {
        try {
          const dataverseId = await syncEntryToDataverse(entry);
          await markEntrySynced(entry.id, dataverseId);
          results.synced++;
        } catch (err) {
          results.errors.push({ entryId: entry.id, error: err.message });
        }
      }

      res.json(results);
    } catch (error) {
      console.error('Dataverse sync error:', error);
      res.status(500).json({ error: 'Sync failed' });
    }
  });

  app.get('/api/dataverse/status', requireAuth, async (req, res) => {
    try {
      const pool = getPool();
      const total = await pool.query(
        'SELECT COUNT(*) FROM entries WHERE user_id = $1', [req.authUserId]
      );
      const synced = await pool.query(
        'SELECT COUNT(*) FROM entries WHERE user_id = $1 AND dataverse_synced_at IS NOT NULL', [req.authUserId]
      );
      const lastSync = await pool.query(
        'SELECT MAX(dataverse_synced_at) as last_sync FROM entries WHERE user_id = $1', [req.authUserId]
      );

      res.json({
        totalEntries: parseInt(total.rows[0].count),
        syncedEntries: parseInt(synced.rows[0].count),
        lastSync: lastSync.rows[0].last_sync,
      });
    } catch (error) {
      console.error('Dataverse status error:', error);
      res.status(500).json({ error: 'Failed to get sync status' });
    }
  });
}

// --- Power Automate webhooks (feature-flagged) ---

if (process.env.ENABLE_WEBHOOKS === 'true') {
  const { default: webhookRouter } = await import('./microsoft/webhooks.js');
  app.use('/api/webhooks', webhookRouter);
}

// boot the server

if (process.env.NODE_ENV !== 'test') {
  initDB().then(() => {
    app.listen(PORT, () => {
      console.log(`ClearMindAI running at http://localhost:${PORT}`);
    });
  }).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
}

export default app;
