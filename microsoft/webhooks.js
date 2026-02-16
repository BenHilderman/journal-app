import { Router } from 'express';
import crypto from 'crypto';

const router = Router();
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

/**
 * Verifies HMAC-SHA256 signature on incoming webhook requests.
 * Power Automate signs payloads so we can verify authenticity.
 */
function verifyHmacSignature(req, res, next) {
  const signature = req.headers['x-webhook-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing webhook signature' });
  }

  const payload = JSON.stringify(req.body);
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  next();
}

// Health check — no signature required, used by Power Automate to test connectivity
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'clearmind-webhooks',
  });
});

// Triggered when Copilot Studio creates a journal entry
router.post('/entry-created', verifyHmacSignature, async (req, res) => {
  try {
    const { entryId, userId, content } = req.body;
    if (!entryId || !content) {
      return res.status(400).json({ error: 'entryId and content are required' });
    }

    console.log(`[webhook] entry-created: ${entryId} for user ${userId}`);

    res.json({
      received: true,
      entryId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Webhook entry-created error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Triggered when mood threshold is breached
router.post('/mood-alert', verifyHmacSignature, async (req, res) => {
  try {
    const { userId, mood, consecutiveCount } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    console.log(`[webhook] mood-alert: user ${userId}, mood=${mood}, consecutive=${consecutiveCount}`);

    res.json({
      received: true,
      alert: true,
      userId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Webhook mood-alert error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Triggered on schedule for Dataverse sync
router.post('/dataverse-sync', verifyHmacSignature, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    console.log(`[webhook] dataverse-sync requested for user ${userId}`);

    res.json({
      received: true,
      userId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Webhook dataverse-sync error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
