import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/clearmind_test';

// n8n is behind a feature flag. Since we can't toggle it at runtime
// (the flag is checked at module load), we test the router directly.

describe('n8n Router (Direct Import)', () => {
  let n8nApp;
  const N8N_API_KEY = 'test-n8n-api-key';

  beforeAll(async () => {
    process.env.N8N_CALLBACK_API_KEY = N8N_API_KEY;

    const express = (await import('express')).default;
    const session = (await import('express-session')).default;
    const { default: n8nRouter } = await import('../n8n/routes.js');

    n8nApp = express();
    n8nApp.use(express.json());
    n8nApp.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true,
    }));
    n8nApp.use('/api/n8n', n8nRouter);
  });

  it('status endpoint responds without auth', async () => {
    const res = await request(n8nApp).get('/api/n8n/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('n8nEnabled');
    expect(res.body).toHaveProperty('n8nConfigured');
    expect(res.body.timestamp).toBeDefined();
  });

  it('config GET requires session auth', async () => {
    const res = await request(n8nApp).get('/api/n8n/config');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Not authenticated');
  });

  it('config POST requires session auth', async () => {
    const res = await request(n8nApp)
      .post('/api/n8n/config')
      .send({ n8nEnabled: true });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Not authenticated');
  });

  it('test endpoint requires session auth', async () => {
    const res = await request(n8nApp)
      .post('/api/n8n/test')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Not authenticated');
  });
});

describe('n8n API Key Verification', () => {
  let verifyFn;

  beforeAll(async () => {
    process.env.N8N_CALLBACK_API_KEY = 'correct-key';
    const { verifyN8nApiKey } = await import('../n8n/routes.js');
    verifyFn = verifyN8nApiKey;
  });

  it('rejects requests without API key', () => {
    const req = { headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    verifyFn(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with wrong API key', () => {
    const req = { headers: { 'x-n8n-api-key': 'wrong-key' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    verifyFn(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts requests with correct API key', () => {
    const req = { headers: { 'x-n8n-api-key': 'correct-key' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    verifyFn(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('n8n Event Emitter', () => {
  it('does not throw when n8n is disabled', async () => {
    const { emitN8nEvent } = await import('../n8n/emitter.js');

    // Should complete without throwing (n8n_enabled is not set in config)
    await expect(
      emitN8nEvent('entry.created', { entryId: 'test', userId: 'user1' })
    ).resolves.toBeUndefined();
  });
});

describe('n8n Feature Flag Isolation', () => {
  it('n8n endpoints return 404 when feature flag is off', async () => {
    // Import the main app (which has ENABLE_N8N unset in test)
    const app = (await import('../server.js')).default;

    const res = await request(app).get('/api/n8n/status');
    expect(res.status).toBe(404);
  });
});
