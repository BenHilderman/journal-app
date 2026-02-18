import { Router } from 'express';
import { getConfig, setConfig } from '../db.js';
import { emitN8nEvent } from './emitter.js';

const router = Router();

/**
 * Validates X-N8N-API-Key header against N8N_CALLBACK_API_KEY env var.
 * Used for n8n→ClearMind callback requests.
 */
export function verifyN8nApiKey(req, res, next) {
  const apiKey = req.headers['x-n8n-api-key'];
  if (!apiKey || apiKey !== process.env.N8N_CALLBACK_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing n8n API key' });
  }
  next();
}

// Health check — unauthenticated, for n8n to ping
router.get('/status', async (req, res) => {
  try {
    const enabled = await getConfig('n8n_enabled');
    const webhookUrl = await getConfig('n8n_webhook_entry_created');
    res.json({
      status: 'ok',
      n8nEnabled: enabled === 'true',
      n8nConfigured: !!(enabled === 'true' && webhookUrl),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[n8n] status check error:', err);
    res.json({ status: 'ok', n8nEnabled: false, n8nConfigured: false, timestamp: new Date().toISOString() });
  }
});

// Get current n8n config — requires session auth
router.get('/config', async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const [enabled, entryCreated, entryAnalyzed, entryDeleted] = await Promise.all([
      getConfig('n8n_enabled'),
      getConfig('n8n_webhook_entry_created'),
      getConfig('n8n_webhook_entry_analyzed'),
      getConfig('n8n_webhook_entry_deleted'),
    ]);
    res.json({
      n8nEnabled: enabled === 'true',
      webhooks: {
        entryCreated: entryCreated || '',
        entryAnalyzed: entryAnalyzed || '',
        entryDeleted: entryDeleted || '',
      },
    });
  } catch (err) {
    console.error('[n8n] config get error:', err);
    res.status(500).json({ error: 'Failed to load n8n config' });
  }
});

// Update n8n config — requires session auth
router.post('/config', async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const { n8nEnabled, webhooks } = req.body;

    if (n8nEnabled !== undefined) {
      await setConfig('n8n_enabled', n8nEnabled ? 'true' : 'false');
    }
    if (webhooks) {
      if (webhooks.entryCreated !== undefined) {
        await setConfig('n8n_webhook_entry_created', webhooks.entryCreated);
      }
      if (webhooks.entryAnalyzed !== undefined) {
        await setConfig('n8n_webhook_entry_analyzed', webhooks.entryAnalyzed);
      }
      if (webhooks.entryDeleted !== undefined) {
        await setConfig('n8n_webhook_entry_deleted', webhooks.entryDeleted);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[n8n] config update error:', err);
    res.status(500).json({ error: 'Failed to update n8n config' });
  }
});

// Fire a test event — requires session auth
router.post('/test', async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const enabled = await getConfig('n8n_enabled');
    if (enabled !== 'true') {
      return res.status(400).json({ error: 'n8n is not enabled' });
    }

    await emitN8nEvent('entry.created', {
      entryId: 'test-' + Date.now(),
      userId: req.session.userId,
      title: 'Test Event',
      contentPreview: 'This is a test event from ClearMindAI.',
      test: true,
    });

    res.json({ success: true, message: 'Test event sent' });
  } catch (err) {
    console.error('[n8n] test event error:', err);
    res.status(500).json({ error: 'Failed to send test event' });
  }
});

export default router;
