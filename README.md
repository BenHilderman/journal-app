# ClearMindAI

AI-powered developer growth journal. Write about your day, get insights back.

Built with Express.js, vanilla JS, and the Groq API. No frontend frameworks, no database server, no build step.

## Tech

| | |
|---|---|
| Backend | Express.js |
| Frontend | Vanilla JS, no build step |
| AI | Groq API (free tier) |
| Storage | JSON files on disk |
| Auth | bcryptjs + express-session |
| Search | Character trigram vectors (384-dim) + cosine similarity |
| Tests | Vitest + Supertest |
| CI | GitHub Actions (Node 18/20/22) |

## How it works

```
Browser
  ├── /api/entries         → reads/writes JSON files
  ├── /api/analyze         → sends entry to Groq, gets mood + tags + summary
  ├── /api/clarity         → Groq generates reflection questions
  ├── /api/search          → trigram embeddings → cosine similarity ranking
  ├── /api/reflect         → finds related past entries, sends context to Groq
  ├── /api/recap           → last 7 days of entries → Groq summary
  ├── /api/insights/mood-trends      → aggregates mood data from analyzed entries
  └── /api/insights/growth-patterns  → full journal history → Groq analysis
```

The search doesn't use any ML model — it builds character trigram frequency vectors and compares them with cosine similarity. It's surprisingly decent for journal-length text.

The mood chart is just inline SVG. Pulling in Chart.js for one line chart felt like overkill.

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

26 tests covering auth, entry CRUD, AI endpoints (mocked), search, and insights. No API key needed — all LLM calls are stubbed out in tests.

## Project structure

```
ClearMindAI/
├── server.js          # everything — routes, auth, AI calls, storage
├── public/
│   ├── index.html     # SPA shell
│   ├── app.js         # frontend logic, SVG charts
│   └── styles.css     # dark theme
├── tests/
│   └── server.test.js
└── .github/workflows/ci.yml
```

Yeah, the whole backend is one file. The app is small enough that splitting it into controllers/models/services would just add indirection without helping readability.
