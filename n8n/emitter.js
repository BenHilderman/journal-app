import { getConfig } from '../db.js';

/**
 * Emits an event to the configured n8n webhook URL.
 * Fire-and-forget — errors are logged but never thrown.
 *
 * @param {string} event - One of: entry.created, entry.analyzed, entry.deleted
 * @param {object} payload - Event data to send
 */
export async function emitN8nEvent(event, payload) {
  try {
    const enabled = await getConfig('n8n_enabled');
    if (enabled !== 'true') return;

    const webhookKey = `n8n_webhook_${event.replace('.', '_')}`;
    const webhookUrl = await getConfig(webhookKey);
    if (!webhookUrl) return;

    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ClearMind-Event': event,
        'X-ClearMind-Timestamp': new Date().toISOString(),
      },
      body: JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload }),
      signal: AbortSignal.timeout(5000),
    });

    console.log(`[n8n] emitted ${event}`);
  } catch (err) {
    console.error(`[n8n] failed to emit ${event}:`, err.message);
  }
}
