import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/clearmind_test';

import app from '../server.js';
import { initDB, getPool } from '../db.js';

let testId = 1000;

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
      email: `msauth_${testId}_${Date.now()}@test.com`,
      password: 'testpass123',
      name: 'MS Auth Test User',
    });
  return agent;
}

describe('Dual Authentication', () => {
  afterEach(() => cleanup());

  it('session auth still works for all protected routes', async () => {
    const agent = await createAuthenticatedAgent();

    // Create entry via session
    const createRes = await agent
      .post('/api/entries')
      .send({ content: 'Session auth test entry' });
    expect(createRes.status).toBe(200);
    expect(createRes.body.entry.content).toBe('Session auth test entry');

    // List entries via session
    const listRes = await agent.get('/api/entries');
    expect(listRes.status).toBe(200);
    expect(listRes.body.entries).toHaveLength(1);
  });

  it('rejects requests without any auth', async () => {
    const res = await request(app).get('/api/entries');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Not authenticated');
  });

  it('rejects invalid Bearer tokens when Azure auth is disabled', async () => {
    // ENABLE_AZURE_AUTH is not set in test env, so Bearer tokens just pass through
    // and fall to "Not authenticated" since no session exists either
    const res = await request(app)
      .get('/api/entries')
      .set('Authorization', 'Bearer invalid-token-here');
    expect(res.status).toBe(401);
  });

  it('session signup creates user and allows immediate API access', async () => {
    const agent = request.agent(app);
    const signupRes = await agent
      .post('/api/auth/signup')
      .send({
        email: `dual_auth_new_${Date.now()}@test.com`,
        password: 'password123',
        name: 'New User',
      });
    expect(signupRes.status).toBe(200);
    expect(signupRes.body.user.email).toContain('dual_auth_new_');

    // Immediately use the session to create an entry
    const entryRes = await agent
      .post('/api/entries')
      .send({ content: 'First post after signup' });
    expect(entryRes.status).toBe(200);
  });

  it('/api/auth/me works with session', async () => {
    const agent = await createAuthenticatedAgent();
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.user).not.toBeNull();
    expect(meRes.body.user.email).toContain('msauth_');
  });

  it('signout destroys session and blocks further access', async () => {
    const agent = await createAuthenticatedAgent();

    // Verify session works
    const beforeRes = await agent.get('/api/entries');
    expect(beforeRes.status).toBe(200);

    // Sign out
    await agent.post('/api/auth/signout');

    // Verify session is destroyed
    const afterRes = await agent.get('/api/entries');
    expect(afterRes.status).toBe(401);
  });
});

describe('Azure AD User Database Functions', () => {
  afterEach(() => cleanup());

  it('findUserByAzureOid and createUserFromAzure work correctly', async () => {
    const { findUserByAzureOid, createUserFromAzure } = await import('../db.js');

    // User should not exist yet
    const notFound = await findUserByAzureOid('test-oid-12345');
    expect(notFound).toBeNull();

    // Create Azure user
    const user = await createUserFromAzure({
      id: 'azure-user-1',
      email: 'azure@contoso.com',
      name: 'Azure Test User',
      azureOid: 'test-oid-12345',
    });
    expect(user.id).toBe('azure-user-1');
    expect(user.email).toBe('azure@contoso.com');
    expect(user.azure_oid).toBe('test-oid-12345');

    // Now findByOid should return the user
    const found = await findUserByAzureOid('test-oid-12345');
    expect(found).not.toBeNull();
    expect(found.id).toBe('azure-user-1');
  });
});
