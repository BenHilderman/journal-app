# n8n Workflow Automation Setup

Self-hosted workflow automation for ClearMindAI using [n8n](https://n8n.io).

## Prerequisites

- Docker and Docker Compose installed
- ClearMindAI running on `localhost:3000`

## 1. Configure Environment

Add to your `.env`:

```env
ENABLE_N8N=true
N8N_CALLBACK_API_KEY=your-secure-random-key
```

Restart the ClearMind server to activate the n8n endpoints.

## 2. Start n8n

```bash
docker compose -f docker-compose.n8n.yml up -d
```

n8n UI will be available at [http://localhost:5678](http://localhost:5678).

Default credentials (change in production):
- Username: `admin`
- Password: `changeme`

Override with env vars: `N8N_BASIC_AUTH_USER`, `N8N_BASIC_AUTH_PASSWORD`.

## 3. Import Workflow Templates

1. Open n8n UI at `http://localhost:5678`
2. Go to **Workflows** > **Import from File**
3. Import each file from `n8n/workflows/`:

| File | What it does |
|------|-------------|
| `auto-analyze-on-create.json` | Auto-analyzes new entries, alerts on severe mood |
| `weekly-recap-digest.json` | Sends weekly recap every Friday at 5 PM |
| `mood-alert-monitor.json` | Checks for 3+ consecutive negative moods daily |
| `monthly-growth-digest.json` | Monthly growth pattern report on 1st of month |

## 4. Configure Workflow Credentials

Each workflow uses two environment variables in n8n:

| Variable | Value |
|----------|-------|
| `CLEARMIND_API_BASE` | `http://host.docker.internal:3000` (Docker) or your deployment URL |
| `CLEARMIND_API_KEY` | Same value as `N8N_CALLBACK_API_KEY` in your ClearMind `.env` |

Set these in n8n UI: **Settings** > **Variables**.

## 5. Configure Webhook URLs

After importing the webhook-triggered workflow (auto-analyze-on-create):

1. Open the workflow in n8n
2. Click the **Webhook** trigger node
3. Copy the webhook URL (e.g., `http://localhost:5678/webhook/clearmind-entry-created`)
4. Configure in ClearMind via the API:

```bash
curl -X POST http://localhost:3000/api/n8n/config \
  -H "Content-Type: application/json" \
  -b "your-session-cookie" \
  -d '{
    "n8nEnabled": true,
    "webhooks": {
      "entryCreated": "http://localhost:5678/webhook/clearmind-entry-created"
    }
  }'
```

## 6. Test the Integration

```bash
# Check n8n status
curl http://localhost:3000/api/n8n/status

# Send a test event (requires session auth)
curl -X POST http://localhost:3000/api/n8n/test \
  -H "Content-Type: application/json" \
  -b "your-session-cookie"
```

## 7. Customize Notification Nodes

The workflow templates include placeholder `NoOp` nodes where notifications should be sent. Replace these with your preferred notification service:

- **Slack**: Use the Slack node with a webhook URL
- **Email**: Use the Send Email node with SMTP credentials
- **Telegram**: Use the Telegram node with a bot token
- **Discord**: Use the Discord node with a webhook URL

## Architecture

```
Entry Created → ClearMind server → POST to n8n Webhook
                                         ↓
                                   n8n workflow runs
                                         ↓
                                   HTTP Request → /api/analyze (X-N8N-API-Key)
                                         ↓
                                   IF severe mood → Notification
```

## Troubleshooting

- **n8n can't reach ClearMind**: Ensure `host.docker.internal` resolves. On Linux, the `extra_hosts` entry in `docker-compose.n8n.yml` handles this.
- **401 on callback**: Check that `N8N_CALLBACK_API_KEY` matches between ClearMind `.env` and n8n environment variables.
- **Webhooks not firing**: Verify `n8n_enabled` is `true` in ClearMind config and webhook URLs are set.
- **Workflow not triggering**: Ensure the workflow is activated (toggle in n8n UI).
