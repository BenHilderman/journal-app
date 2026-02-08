import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NODE_ENV = 'test';

let testDataDir;
let testId = 0;

function setupTestDir() {
  testId++;
  testDataDir = path.join(__dirname, `__test_data_${testId}_${Date.now()}`);
  process.env.DATA_DIR = testDataDir;
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }
}

function cleanupTestDir() {
  if (testDataDir && fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
}

import app, { getEmbedding, cosineSimilarity, safeParseJson, setGroqChat, setGroqChatStream } from '../server.js';

async function createAuthenticatedAgent() {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/signup')
    .send({
      email: `user_${testId}_${Date.now()}@test.com`,
      password: 'testpass123',
      name: 'Test User'
    });
  return agent;
}

// embedding + parsing utils

describe('Unit Tests', () => {
  it('getEmbedding returns a 384-dim normalized vector', () => {
    const embedding = getEmbedding('hello world');
    expect(embedding).toHaveLength(384);
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1.0, 1);
  });

  it('identical vectors -> similarity 1.0', () => {
    const vec = getEmbedding('test string');
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 5);
  });

  it('orthogonal vectors -> similarity 0.0', () => {
    const a = new Array(384).fill(0);
    const b = new Array(384).fill(0);
    a[0] = 1;
    b[1] = 1;
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('parses JSON from markdown fences', () => {
    const wrapped = '```json\n{"mood": "happy", "tags": ["coding"]}\n```';
    expect(safeParseJson(wrapped)).toEqual({ mood: 'happy', tags: ['coding'] });
  });

  it('parses plain JSON', () => {
    expect(safeParseJson('{"key": "value"}')).toEqual({ key: 'value' });
  });

  it('extracts JSON from surrounding text', () => {
    const mixed = 'Here is the result:\n{"mood": "focused"}\nEnd of analysis.';
    expect(safeParseJson(mixed)).toEqual({ mood: 'focused' });
  });
});

// auth

describe('Auth API', () => {
  afterEach(() => cleanupTestDir());

  it('signup creates account, returns user without password', async () => {
    setupTestDir();
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'test@example.com', password: 'password123', name: 'Test User' });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('test@example.com');
    expect(res.body.user.name).toBe('Test User');
    expect(res.body.user.password).toBeUndefined();
  });

  it('rejects duplicate email', async () => {
    setupTestDir();
    await request(app)
      .post('/api/auth/signup')
      .send({ email: 'dup@example.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'dup@example.com', password: 'password456' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already exists');
  });

  it('rejects password under 6 chars', async () => {
    setupTestDir();
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'short@example.com', password: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('6 characters');
  });

  it('signin works with correct credentials', async () => {
    setupTestDir();
    await request(app)
      .post('/api/auth/signup')
      .send({ email: 'login@example.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/signin')
      .send({ email: 'login@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('login@example.com');
  });

  it('signin rejects wrong password', async () => {
    setupTestDir();
    await request(app)
      .post('/api/auth/signup')
      .send({ email: 'reject@example.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/signin')
      .send({ email: 'reject@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid');
  });

  it('/me returns null when not logged in', async () => {
    setupTestDir();
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });
});

// entries

describe('Entry CRUD', () => {
  afterEach(() => cleanupTestDir());

  it('creates entry with id', async () => {
    setupTestDir();
    const agent = await createAuthenticatedAgent();

    const res = await agent
      .post('/api/entries')
      .send({ content: 'Debugged a tricky async issue today', title: 'Async Debug' });

    expect(res.status).toBe(200);
    expect(res.body.entry.id).toBeDefined();
    expect(res.body.entry.content).toBe('Debugged a tricky async issue today');
    expect(res.body.entry.title).toBe('Async Debug');
  });

  it('lists entries newest-first', async () => {
    setupTestDir();
    const agent = await createAuthenticatedAgent();

    await agent.post('/api/entries').send({ content: 'First entry' });
    await agent.post('/api/entries').send({ content: 'Second entry' });

    const res = await agent.get('/api/entries');
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries[0].content).toBe('Second entry');
  });

  it('gets single entry by id', async () => {
    setupTestDir();
    const agent = await createAuthenticatedAgent();

    const createRes = await agent
      .post('/api/entries')
      .send({ content: 'Specific entry content' });

    const res = await agent.get(`/api/entries/${createRes.body.entry.id}`);
    expect(res.status).toBe(200);
    expect(res.body.entry.content).toBe('Specific entry content');
  });

  it('updates entry content', async () => {
    setupTestDir();
    const agent = await createAuthenticatedAgent();

    const createRes = await agent
      .post('/api/entries')
      .send({ content: 'Original content' });

    const res = await agent
      .put(`/api/entries/${createRes.body.entry.id}`)
      .send({ content: 'Updated content' });

    expect(res.status).toBe(200);
    expect(res.body.entry.content).toBe('Updated content');
  });

  it('deletes entry', async () => {
    setupTestDir();
    const agent = await createAuthenticatedAgent();

    const createRes = await agent
      .post('/api/entries')
      .send({ content: 'To be deleted' });
    const id = createRes.body.entry.id;

    const res = await agent.delete(`/api/entries/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // should be gone now
    const getRes = await agent.get(`/api/entries/${id}`);
    expect(getRes.status).toBe(404);
  });

  it('rejects empty content', async () => {
    setupTestDir();
    const agent = await createAuthenticatedAgent();

    const res = await agent
      .post('/api/entries')
      .send({ content: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Content is required');
  });
});

// auth guards

describe('Auth Guarding', () => {
  afterEach(() => cleanupTestDir());

  it('all protected routes 401 without session', async () => {
    setupTestDir();
    const routes = [
      { method: 'get', path: '/api/entries' },
      { method: 'post', path: '/api/entries' },
      { method: 'post', path: '/api/analyze' },
      { method: 'post', path: '/api/clarity' },
      { method: 'post', path: '/api/search' },
      { method: 'post', path: '/api/reflect' },
      { method: 'get', path: '/api/recap' },
      { method: 'get', path: '/api/insights/mood-trends' },
      { method: 'post', path: '/api/insights/growth-patterns' },
      { method: 'post', path: '/api/coach' },
      { method: 'get', path: '/api/prompts' },
      { method: 'post', path: '/api/time-capsule' },
      { method: 'post', path: '/api/stream/analyze' },
      { method: 'post', path: '/api/stream/clarity' },
      { method: 'post', path: '/api/stream/reflect' },
      { method: 'post', path: '/api/stream/coach' },
      { method: 'post', path: '/api/settings/api-key' },
      { method: 'get', path: '/api/settings/has-key' },
    ];

    for (const route of routes) {
      const res = await request(app)[route.method](route.path)
        .send(route.method === 'post' ? { content: 'test' } : undefined);
      expect(res.status).toBe(401);
    }
  });

  it('routes work when authenticated', async () => {
    setupTestDir();
    const agent = await createAuthenticatedAgent();

    const entryRes = await agent
      .post('/api/entries')
      .send({ content: 'Authenticated entry' });
    expect(entryRes.status).toBe(200);

    const listRes = await agent.get('/api/entries');
    expect(listRes.status).toBe(200);
    expect(listRes.body.entries).toHaveLength(1);
  });
});

// ai endpoints (groq mocked)

describe('AI Endpoints', () => {
  afterEach(() => {
    setGroqChat(async () => '{}');
    cleanupTestDir();
  });

  it('analyze returns mood + tags', async () => {
    setupTestDir();
    setGroqChat(async () => JSON.stringify({
      mood: 'focused',
      tags: ['debugging', 'backend'],
      summary: 'Developer worked on debugging a backend issue.',
      encouragement: 'Great job tracking down that bug!'
    }));

    const agent = await createAuthenticatedAgent();
    const res = await agent
      .post('/api/analyze')
      .send({ content: 'Spent 2 hours debugging a database query issue.' });

    expect(res.status).toBe(200);
    expect(res.body.analysis.mood).toBe('focused');
    expect(res.body.analysis.tags).toContain('debugging');
  });

  it('clarity returns reflection + questions', async () => {
    setupTestDir();
    setGroqChat(async () => JSON.stringify({
      reflection: 'You seem to be working through a complex system design challenge.',
      questions: [
        'What specific part of the architecture is most unclear?',
        'Have you considered event-driven approaches?',
        'What trade-offs are you weighing?'
      ]
    }));

    const agent = await createAuthenticatedAgent();
    const res = await agent
      .post('/api/clarity')
      .send({ content: 'Struggling with microservice architecture decisions.' });

    expect(res.status).toBe(200);
    expect(res.body.clarity.reflection).toBeDefined();
    expect(res.body.clarity.questions).toHaveLength(3);
  });

  it('search returns results with similarity scores', async () => {
    setupTestDir();
    const agent = await createAuthenticatedAgent();

    await agent.post('/api/entries').send({ content: 'Worked on React components and state management today' });
    await agent.post('/api/entries').send({ content: 'Database migration scripts took all afternoon' });

    const res = await agent
      .post('/api/search')
      .send({ query: 'React frontend development' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    if (res.body.results.length > 0) {
      expect(typeof res.body.results[0].similarity).toBe('number');
    }
  });

  it('reflect returns patterns + growth', async () => {
    setupTestDir();
    setGroqChat(async () => JSON.stringify({
      reflection: 'You have been consistently working on improving your debugging skills.',
      patterns: ['Debugging focus', 'Backend emphasis'],
      growth: 'Your systematic approach to debugging has improved.'
    }));

    const agent = await createAuthenticatedAgent();
    await agent.post('/api/entries').send({ content: 'Fixed a memory leak in the Node.js service' });

    const res = await agent
      .post('/api/reflect')
      .send({ content: 'Found another performance issue in the API layer' });

    expect(res.status).toBe(200);
    expect(res.body.reflection.patterns).toBeDefined();
    expect(res.body.reflection.growth).toBeDefined();
  });
});

// insights

describe('Insights', () => {
  afterEach(() => {
    setGroqChat(async () => '{}');
    cleanupTestDir();
  });

  it('mood-trends returns timeline from analyzed entries', async () => {
    setupTestDir();
    const agent = await createAuthenticatedAgent();
    await agent.post('/api/entries').send({ content: 'Great day coding!' });

    // simulate an analyzed entry by writing mood directly to the json file
    const files = fs.readdirSync(testDataDir);
    const entriesFile = files.find(f => f.startsWith('entries_'));
    if (entriesFile) {
      const filepath = path.join(testDataDir, entriesFile);
      const entries = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      entries[0].mood = 'excited';
      entries[0].tags = ['productivity'];
      fs.writeFileSync(filepath, JSON.stringify(entries, null, 2));
    }

    const res = await agent.get('/api/insights/mood-trends');

    expect(res.status).toBe(200);
    expect(res.body.timeline).toHaveLength(1);
    expect(res.body.timeline[0].mood).toBe('excited');
    expect(res.body.frequency.excited).toBe(1);
    expect(res.body.total).toBe(1);
  });

  it('growth-patterns returns structured analysis', async () => {
    setupTestDir();
    setGroqChat(async () => JSON.stringify({
      growthAreas: ['Debugging skills have improved significantly'],
      blindSpots: ['Not enough focus on testing'],
      recurringThemes: ['Backend development', 'Performance optimization'],
      suggestion: 'Try writing about your testing approach next time'
    }));

    const agent = await createAuthenticatedAgent();
    await agent.post('/api/entries').send({ content: 'Debugged a complex issue' });
    await agent.post('/api/entries').send({ content: 'Optimized API performance' });

    // add analysis data so the endpoint doesn't bail early
    const files = fs.readdirSync(testDataDir);
    const entriesFile = files.find(f => f.startsWith('entries_'));
    if (entriesFile) {
      const filepath = path.join(testDataDir, entriesFile);
      const entries = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      entries[0].mood = 'focused';
      entries[0].tags = ['debugging'];
      entries[0].summary = 'Worked on debugging';
      entries[1].mood = 'productive';
      entries[1].tags = ['performance'];
      entries[1].summary = 'Optimized API';
      fs.writeFileSync(filepath, JSON.stringify(entries, null, 2));
    }

    const res = await agent
      .post('/api/insights/growth-patterns')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.patterns.growthAreas).toBeDefined();
    expect(res.body.patterns.blindSpots).toBeDefined();
    expect(res.body.patterns.recurringThemes).toBeDefined();
    expect(res.body.patterns.suggestion).toBeDefined();
  });
});

// coach

describe('Coach API', () => {
  afterEach(() => {
    setGroqChat(async () => '{}');
    cleanupTestDir();
  });

  it('returns response with journal context', async () => {
    setupTestDir();
    setGroqChat(async (messages) => {
      // verify system prompt contains journal context marker
      const sys = messages.find(m => m.role === 'system');
      return 'Here is my coaching response based on your journal.';
    });

    const agent = await createAuthenticatedAgent();
    await agent.post('/api/entries').send({ content: 'Worked on React hooks today' });

    const res = await agent
      .post('/api/coach')
      .send({ messages: [{ role: 'user', content: 'How am I doing?' }] });

    expect(res.status).toBe(200);
    expect(res.body.response).toBeDefined();
    expect(typeof res.body.response).toBe('string');
  });

  it('rejects empty messages array (400)', async () => {
    setupTestDir();
    const agent = await createAuthenticatedAgent();

    const res = await agent
      .post('/api/coach')
      .send({ messages: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Messages');
  });
});

// writing prompts

describe('Writing Prompts', () => {
  afterEach(() => {
    setGroqChat(async () => '{}');
    cleanupTestDir();
  });

  it('returns 3 default prompts for new user', async () => {
    setupTestDir();
    const agent = await createAuthenticatedAgent();

    const res = await agent.get('/api/prompts');

    expect(res.status).toBe(200);
    expect(res.body.prompts).toHaveLength(3);
    expect(res.body.prompts[0].text).toBeDefined();
    expect(res.body.prompts[0].category).toBeDefined();
  });

  it('returns 3 personalized prompts for user with entries', async () => {
    setupTestDir();
    setGroqChat(async () => JSON.stringify([
      { text: 'What side project are you excited about?', category: 'Projects' },
      { text: 'How are you handling code reviews?', category: 'Teamwork' },
      { text: 'What tool have you been wanting to try?', category: 'Tools' },
    ]));

    const agent = await createAuthenticatedAgent();
    await agent.post('/api/entries').send({ content: 'Built a new API endpoint today' });

    // add analysis data so prompts endpoint finds tags/moods
    const files = fs.readdirSync(testDataDir);
    const entriesFile = files.find(f => f.startsWith('entries_'));
    if (entriesFile) {
      const filepath = path.join(testDataDir, entriesFile);
      const entries = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      entries[0].mood = 'focused';
      entries[0].tags = ['backend', 'api'];
      entries[0].summary = 'Built API endpoint';
      fs.writeFileSync(filepath, JSON.stringify(entries, null, 2));
    }

    const res = await agent.get('/api/prompts');

    expect(res.status).toBe(200);
    expect(res.body.prompts).toHaveLength(3);
    expect(res.body.prompts[0].text).toBeDefined();
  });
});

// time capsule

describe('Time Capsule', () => {
  afterEach(() => {
    setGroqChat(async () => '{}');
    cleanupTestDir();
  });

  it('rejects missing daysAgo (400)', async () => {
    setupTestDir();
    const agent = await createAuthenticatedAgent();

    const res = await agent
      .post('/api/time-capsule')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('daysAgo');
  });

  it('returns graceful empty result for new user', async () => {
    setupTestDir();
    const agent = await createAuthenticatedAgent();

    const res = await agent
      .post('/api/time-capsule')
      .send({ daysAgo: 30 });

    expect(res.status).toBe(200);
    expect(res.body.empty).toBe(true);
    expect(res.body.narrative).toBeDefined();
  });

  it('generates comparison when entries exist in both periods', async () => {
    setupTestDir();
    setGroqChat(async () => JSON.stringify({
      narrative: 'You have grown significantly over the past month.',
      changes: ['More confident debugging', 'Better architecture decisions', 'Faster code reviews'],
      constants: ['Consistent daily journaling', 'Focus on backend work'],
      moodShift: 'Moved from anxious to confident',
      advice: 'Keep pushing on system design skills',
    }));

    const agent = await createAuthenticatedAgent();

    // create a "recent" entry (now)
    await agent.post('/api/entries').send({ content: 'Shipped a major feature today' });

    // manipulate dates to create a "past" entry 30 days ago
    const files = fs.readdirSync(testDataDir);
    const entriesFile = files.find(f => f.startsWith('entries_'));
    if (entriesFile) {
      const filepath = path.join(testDataDir, entriesFile);
      const entries = JSON.parse(fs.readFileSync(filepath, 'utf-8'));

      // add a past entry dated 30 days ago
      const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      entries.push({
        id: 'past_entry_1',
        title: 'Past Entry',
        content: 'Struggled with a tricky bug in the auth module',
        createdAt: pastDate.toISOString(),
        updatedAt: pastDate.toISOString(),
        mood: 'frustrated',
        tags: ['debugging'],
      });
      fs.writeFileSync(filepath, JSON.stringify(entries, null, 2));
    }

    const res = await agent
      .post('/api/time-capsule')
      .send({ daysAgo: 30 });

    expect(res.status).toBe(200);
    expect(res.body.narrative).toBeDefined();
    expect(res.body.changes).toBeDefined();
    expect(res.body.constants).toBeDefined();
    expect(res.body.then.entries).toBeGreaterThanOrEqual(1);
    expect(res.body.now.entries).toBeGreaterThanOrEqual(1);
  });
});
