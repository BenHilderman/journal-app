# ClearMindAI - AI Features

This document identifies the files that use AI and how they integrate with the journaling application.

## Files Using AI

### Backend: [server.js](server.js)

The main backend file contains all AI-related logic:

| Feature | Lines | Description |
|---------|-------|-------------|
| **Groq LLM Integration** | [104-128](server.js#L104-L128) | Calls Groq's API using Llama 3.1-8b-instant model for chat completions |
| **Text Embeddings** | [148-200](server.js#L148-L200) | Generates 384-dimensional vectors using a bag-of-words hashing approach for semantic similarity |
| **Entry Analysis** | [706-774](server.js#L706-L774) | `/api/analyze` - Extracts summary, tags, mood, action items, and insights from entries |
| **Clarity Questions** | [789-836](server.js#L789-L836) | `/api/clarity` - Generates reflective questions to help users explore their feelings |
| **Semantic Search** | [852-897](server.js#L852-L897) | `/api/search` - Finds entries by meaning using cosine similarity on embeddings |
| **RAG Reflection** | [919-1002](server.js#L919-L1002) | `/api/reflect` - Retrieves relevant past entries and generates personalized insights |
| **Weekly Recap** | [1024-1112](server.js#L1024-L1112) | `/api/recap/weekly` - AI-generated summary of the past week's journaling |
| **Embedding Regeneration** | [1123-1150](server.js#L1123-L1150) | `/api/embeddings/regenerate` - Rebuilds all embeddings for a user |

### Frontend: [public/app.js](public/app.js)

The frontend calls the AI APIs and displays results:

| Feature | Lines | Description |
|---------|-------|-------------|
| **Analyze Entry** | [973-999](public/app.js#L973-L999) | `analyzeCurrentEntry()` - Triggers AI analysis and displays results |
| **Clarity Questions** | [1002-1033](public/app.js#L1002-L1033) | `getClarityForEntry()` - Requests and displays reflective questions |
| **Semantic Search** | [1070-1131](public/app.js#L1070-L1131) | `performSearch()` - Searches entries by meaning, shows similarity scores |
| **Reflection** | [1142-1201](public/app.js#L1142-L1201) | `performReflection()` - Generates insights from past entries on a topic |
| **Weekly Recap** | [1212-1268](public/app.js#L1212-L1268) | `generateRecap()` - Displays AI-generated weekly summary |

## AI Architecture

```
User Action
    |
    v
[public/app.js] --> API Call --> [server.js]
                                      |
                                      v
                              +---------------+
                              | Groq API      |  (LLM - Llama 3.1)
                              +---------------+
                                      |
                                      v
                              JSON Response
                                      |
    +--------------------------------+
    |
    v
[public/app.js] --> Render Results
```

## API Keys Required

Set in `.env` file:
- `GROQ_API_KEY` - Required for all AI features (free at groq.com)
- `HF_API_KEY` - Optional, for HuggingFace (not currently used)
