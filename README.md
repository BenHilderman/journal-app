# ClearMindAI

AI-powered growth journal built on **Google Agent Development Kit (ADK)**.

Write about your day, get insights back — powered by specialized AI agents that analyze mood, track growth, and coach you through reflection.

## Agent Architecture

ClearMindAI uses Google ADK to orchestrate 6 specialized AI agents:

| Agent | Purpose | Tools |
|-------|---------|-------|
| Mood Analyst | Detects mood, tags, summary, encouragement | — |
| Clarity Coach | Reflection + 3 clarifying questions | — |
| Reflector | RAG-powered pattern detection + growth tracking | search-entries, find-related |
| Recap Writer | Weekly summary generation | get-entries |
| Growth Analyst | Long-term trend analysis | get-entries |
| Coach | Interactive multi-turn coaching | get-entries, find-related |

```
Browser → Express Routes → ADK Runner → Agent Pipeline → LLM (Groq or Gemini)
                                              ↓
                                         ADK Tools (search entries, get history, find related)
```

## LLM Providers

Supports **Groq** (Llama 3.1, free tier) and **Google Gemini**. Switch providers in-app via the settings modal.

## Workflow Automation (n8n)

Optional self-hosted workflow engine — replaces Power Automate with an open-source alternative.

```bash
# Start n8n (Docker)
docker compose -f docker-compose.n8n.yml up -d
# → http://localhost:5678
```

Pre-built workflow templates in `n8n/workflows/`:
- **Auto-Analyze**: Triggers analysis on new entries, alerts on severe mood
- **Weekly Recap**: Friday digest with AI summary
- **Mood Monitor**: Daily check for 3+ consecutive negative moods
- **Monthly Growth**: Growth pattern report on 1st of each month

Set `ENABLE_N8N=true` and `N8N_CALLBACK_API_KEY` in `.env`. See [docs/n8n-setup.md](docs/n8n-setup.md) for full setup guide.

## Tech

| | |
|---|---|
| Agent Framework | Google ADK (`@google/adk`) |
| Backend | Express.js |
| Frontend | Vanilla JS, no build step |
| AI (default) | Groq API (Llama 3.1, free tier) |
| AI (optional) | Google Gemini |
| Storage | PostgreSQL |
| Auth | bcryptjs + express-session |
| Search | Character trigram vectors (384-dim) + cosine similarity |
| Tests | Vitest + Supertest |
| CI | GitHub Actions (Node 18/20/22) |

## How it works

```
Browser
  ├── /api/entries                    → PostgreSQL CRUD
  ├── /api/analyze                    → ADK Mood Analyst Agent
  ├── /api/clarity                    → ADK Clarity Coach Agent
  ├── /api/search                     → trigram embeddings → cosine similarity
  ├── /api/reflect                    → ADK Reflector Agent (RAG)
  ├── /api/recap                      → ADK Recap Writer Agent
  ├── /api/insights/mood-trends       → aggregates mood data
  ├── /api/insights/growth-patterns   → ADK Growth Analyst Agent
  ├── /api/coach                      → ADK Coach Agent (multi-turn)
  ├── /api/agents/status              → ADK agent registry info
  └── /api/settings/llm-provider      → switch between Groq / Gemini
```

## Setup

```bash
git clone <repo-url>
cd ClearMindAI
npm install

# grab a free key from console.groq.com
export GROQ_API_KEY=your_key_here

npm start
# → http://localhost:3000
```

## Tests

```bash
npm test          # run once
npm run test:watch  # watch mode
```

26 tests covering auth, entry CRUD, AI endpoints (mocked), search, and insights.

## Project structure

```
ClearMindAI/
├── agents/                # Google ADK agent definitions
│   ├── index.js           # ADK runner, session service, agent registry
│   ├── models.js          # LLM provider abstraction (Groq ↔ Gemini)
│   ├── mood-analyst.js    # Mood analysis agent
│   ├── clarity-coach.js   # Clarity + questions agent
│   ├── reflector.js       # RAG-powered reflection agent
│   ├── recap-writer.js    # Weekly recap agent
│   ├── growth-analyst.js  # Growth pattern agent
│   ├── coach.js           # Multi-turn coaching agent
│   └── tools/
│       ├── search-entries.js  # Semantic search tool
│       ├── get-entries.js     # Entry fetching tool
│       └── find-related.js   # Related entries tool
├── server.js              # Express routes, auth, ADK integration
├── utils.js               # Shared utilities (embeddings, JSON parsing)
├── db.js                  # PostgreSQL schema + helpers
├── n8n/                   # n8n workflow automation
│   ├── emitter.js         # Event emitter (fire-and-forget to n8n)
│   ├── routes.js          # Express router (status, config, test)
│   └── workflows/         # Importable n8n workflow templates
├── public/
│   ├── index.html         # SPA shell
│   ├── app.js             # Frontend logic, SVG charts
│   └── styles.css         # Beige theme
├── tests/
│   ├── server.test.js
│   └── n8n.test.js
├── docs/
│   └── n8n-setup.md       # n8n setup guide
├── docker-compose.n8n.yml # Docker Compose for self-hosted n8n
└── .github/workflows/ci.yml
```
