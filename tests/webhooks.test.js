import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/clearmind_test';

// Webhooks are behind a feature flag. Since we can't toggle it at runtime
// (the flag is checked at module load), we test the webhook router directly.

describe('Webhook Router (Direct Import)', () => {
  let webhookApp;
  const WEBHOOK_SECRET = 'test-webhook-secret';

  function signPayload(body) {
    return crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
  }

  // Set up a minimal Express app with just the webhook router
  beforeAll(async () => {
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    const express = (await import('express')).default;
    const { default: webhookRouter } = await import('../microsoft/webhooks.js');
    webhookApp = express();
    webhookApp.use(express.json());
    webhookApp.use('/api/webhooks', webhookRouter);
  });

  it('health endpoint responds without signature', async () => {
    const res = await request(webhookApp).get('/api/webhooks/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('clearmind-webhooks');
    expect(res.body.timestamp).toBeDefined();
  });

  it('rejects requests without HMAC signature', async () => {
    const res = await request(webhookApp)
      .post('/api/webhooks/entry-created')
      .send({ entryId: '123', content: 'test' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Missing webhook signature');
  });

  it('rejects requests with invalid HMAC signature', async () => {
    const res = await request(webhookApp)
      .post('/api/webhooks/entry-created')
      .set('x-webhook-signature', 'invalid-signature-here')
      .send({ entryId: '123', content: 'test' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid webhook signature');
  });

  it('accepts entry-created with valid HMAC signature', async () => {
    const body = { entryId: 'entry-1', userId: 'user-1', content: 'Hello journal' };
    const signature = signPayload(body);

    const res = await request(webhookApp)
      .post('/api/webhooks/entry-created')
      .set('x-webhook-signature', signature)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.entryId).toBe('entry-1');
  });

  it('accepts mood-alert with valid HMAC signature', async () => {
    const body = { userId: 'user-1', mood: 'anxious', consecutiveCount: 3 };
    const signature = signPayload(body);

    const res = await request(webhookApp)
      .post('/api/webhooks/mood-alert')
      .set('x-webhook-signature', signature)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.alert).toBe(true);
  });

  it('accepts dataverse-sync with valid HMAC signature', async () => {
    const body = { userId: 'user-1' };
    const signature = signPayload(body);

    const res = await request(webhookApp)
      .post('/api/webhooks/dataverse-sync')
      .set('x-webhook-signature', signature)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('rejects entry-created with missing required fields', async () => {
    const body = { userId: 'user-1' }; // missing entryId and content
    const signature = signPayload(body);

    const res = await request(webhookApp)
      .post('/api/webhooks/entry-created')
      .set('x-webhook-signature', signature)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('required');
  });
});

describe('Webhook Feature Flag Isolation', () => {
  it('webhook endpoints return 404 when feature flag is off', async () => {
    // Import the main app (which has ENABLE_WEBHOOKS unset in test)
    const app = (await import('../server.js')).default;

    const res = await request(app).get('/api/webhooks/health');
    expect(res.status).toBe(404);
  });
});
