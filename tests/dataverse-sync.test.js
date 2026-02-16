import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/clearmind_test';

import app from '../server.js';
import { initDB, getPool, getUnsyncedEntries, markEntrySynced } from '../db.js';

let testId = 2000;

async function cleanup() {
  const pool = getPool();
  await pool.query('DELETE FROM entries');
  await pool.query('DELETE FROM users');
}

async function createAuthenticatedAgent() {
  testId++;
  const agent = request.agent(app);
  await agent
    .post('/api/auth/signup')
    .send({
      email: `dv_${testId}_${Date.now()}@test.com`,
      password: 'testpass123',
      name: 'Dataverse Test User',
    });
  return agent;
}

describe('Dataverse Sync Database Functions', () => {
  afterEach(() => cleanup());

  it('getUnsyncedEntries returns entries without dataverse_synced_at', async () => {
    const agent = await createAuthenticatedAgent();

    // Create two entries
    await agent.post('/api/entries').send({ content: 'Entry 1 for sync test' });
    await agent.post('/api/entries').send({ content: 'Entry 2 for sync test' });

    // Get user ID
    const meRes = await agent.get('/api/auth/me');
    const userId = meRes.body.user.id;

    // Both should be unsynced
    const unsynced = await getUnsyncedEntries(userId);
    expect(unsynced).toHaveLength(2);
  });

  it('markEntrySynced updates the entry correctly', async () => {
    const agent = await createAuthenticatedAgent();

    const createRes = await agent.post('/api/entries').send({ content: 'Sync me' });
    const entryId = createRes.body.entry.id;

    const meRes = await agent.get('/api/auth/me');
    const userId = meRes.body.user.id;

    // Mark as synced
    await markEntrySynced(entryId, 'dataverse-id-abc');

    // Should no longer appear in unsynced
    const unsynced = await getUnsyncedEntries(userId);
    expect(unsynced).toHaveLength(0);

    // Verify the dataverse fields were set
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT dataverse_id, dataverse_synced_at FROM entries WHERE id = $1',
      [entryId]
    );
    expect(rows[0].dataverse_id).toBe('dataverse-id-abc');
    expect(rows[0].dataverse_synced_at).not.toBeNull();
  });
});

describe('Dataverse Endpoints (Feature Flag Isolation)', () => {
  afterEach(() => cleanup());

  it('dataverse sync endpoint returns 404 when feature flag is off', async () => {
    const agent = await createAuthenticatedAgent();

    // ENABLE_DATAVERSE_SYNC is not set, so these routes should not exist
    const syncRes = await agent.post('/api/dataverse/sync').send({});
    expect(syncRes.status).toBe(404);

    const statusRes = await agent.get('/api/dataverse/status');
    expect(statusRes.status).toBe(404);
  });
});
