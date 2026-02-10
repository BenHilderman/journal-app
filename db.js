import pg from 'pg';

const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

export async function initDB() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password TEXT NOT NULL,
      api_key TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT DEFAULT 'Untitled Entry',
      content TEXT NOT NULL,
      mood TEXT,
      tags JSONB,
      summary TEXT,
      encouragement TEXT,
      analyzed_at TIMESTAMPTZ,
      embedding JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
}

// --- Users ---

export async function findUserByEmail(email) {
  const { rows } = await getPool().query(
    'SELECT * FROM users WHERE email = $1', [email]
  );
  return rows[0] || null;
}

export async function createUser({ id, email, name, password }) {
  const { rows } = await getPool().query(
    `INSERT INTO users (id, email, name, password) VALUES ($1, $2, $3, $4)
     RETURNING id, email, name, created_at`,
    [id, email, name, password]
  );
  return rows[0];
}

export async function findUserById(id) {
  const { rows } = await getPool().query(
    'SELECT * FROM users WHERE id = $1', [id]
  );
  return rows[0] || null;
}

export async function setUserApiKey(userId, apiKey) {
  await getPool().query(
    'UPDATE users SET api_key = $1 WHERE id = $2',
    [apiKey, userId]
  );
}

export async function getUserApiKey(userId) {
  const { rows } = await getPool().query(
    'SELECT api_key FROM users WHERE id = $1', [userId]
  );
  return rows[0]?.api_key || null;
}

// --- Entries ---

export async function createEntry({ id, userId, title, content, embedding }) {
  const { rows } = await getPool().query(
    `INSERT INTO entries (id, user_id, title, content, embedding)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, title, content, mood, tags, summary, encouragement, analyzed_at, created_at, updated_at`,
    [id, userId, title, content, JSON.stringify(embedding)]
  );
  return rows[0];
}

export async function getEntries(userId) {
  const { rows } = await getPool().query(
    `SELECT id, title, content, mood, tags, summary, encouragement, analyzed_at, created_at, updated_at
     FROM entries WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

export async function getEntryById(userId, entryId) {
  const { rows } = await getPool().query(
    `SELECT id, title, content, mood, tags, summary, encouragement, analyzed_at, created_at, updated_at
     FROM entries WHERE id = $1 AND user_id = $2`,
    [entryId, userId]
  );
  return rows[0] || null;
}

export async function updateEntry(userId, entryId, { content, title, embedding }) {
  const sets = [];
  const vals = [];
  let idx = 1;

  if (content !== undefined) {
    sets.push(`content = $${idx++}`);
    vals.push(content);
    sets.push(`embedding = $${idx++}`);
    vals.push(JSON.stringify(embedding));
  }
  if (title !== undefined) {
    sets.push(`title = $${idx++}`);
    vals.push(title);
  }
  sets.push(`updated_at = NOW()`);
  vals.push(entryId, userId);

  const { rows } = await getPool().query(
    `UPDATE entries SET ${sets.join(', ')} WHERE id = $${idx++} AND user_id = $${idx}
     RETURNING id, title, content, mood, tags, summary, encouragement, analyzed_at, created_at, updated_at`,
    vals
  );
  return rows[0] || null;
}

export async function deleteEntry(userId, entryId) {
  const { rowCount } = await getPool().query(
    'DELETE FROM entries WHERE id = $1 AND user_id = $2',
    [entryId, userId]
  );
  return rowCount > 0;
}

export async function getEntriesWithEmbeddings(userId) {
  const { rows } = await getPool().query(
    `SELECT id, title, content, mood, tags, summary, created_at, embedding
     FROM entries WHERE user_id = $1 AND embedding IS NOT NULL`,
    [userId]
  );
  return rows;
}

export async function getEntriesInDateRange(userId, start, end) {
  const { rows } = await getPool().query(
    `SELECT id, title, content, mood, tags, summary, encouragement, created_at, updated_at
     FROM entries WHERE user_id = $1 AND created_at >= $2 AND created_at <= $3
     ORDER BY created_at DESC`,
    [userId, start, end]
  );
  return rows;
}

export async function getAnalyzedEntries(userId) {
  const { rows } = await getPool().query(
    `SELECT id, title, content, mood, tags, summary, created_at
     FROM entries WHERE user_id = $1 AND (tags IS NOT NULL OR mood IS NOT NULL OR summary IS NOT NULL)
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

export async function updateEntryAnalysis(userId, entryId, { mood, tags, summary }) {
  const { rows } = await getPool().query(
    `UPDATE entries SET mood = $1, tags = $2, summary = $3, analyzed_at = NOW()
     WHERE id = $4 AND user_id = $5
     RETURNING id, title, content, mood, tags, summary, analyzed_at, created_at, updated_at`,
    [mood, JSON.stringify(tags), summary, entryId, userId]
  );
  return rows[0] || null;
}

// --- Config ---

export async function getConfig(key) {
  const { rows } = await getPool().query(
    'SELECT value FROM config WHERE key = $1', [key]
  );
  return rows[0]?.value || null;
}

export async function setConfig(key, value) {
  await getPool().query(
    `INSERT INTO config (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, value]
  );
}
