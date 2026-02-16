# ClearMind AI - Architecture Overview

## System Architecture Diagram

```
+------------------+       +---------------------+       +-------------------------+
|                  |       |                     |       |                         |
|  Web Frontend    +------>+                     +------>+  Groq LLM (Llama 3)    |
|  (React SPA)    |       |                     |       |  - Mood analysis        |
|                  |       |                     |       |  - Coaching responses   |
+------------------+       |                     |       |  - Recap generation     |
                           |                     |       |  - Semantic search      |
+------------------+       |   Express API       |       +-------------------------+
|                  |       |   (Node.js)         |
|  Copilot Studio  +------>+                     +------>+-------------------------+
|  Bot             |       |   - Auth middleware  |       |                         |
|  (Teams / Web)   |       |   - Rate limiting   |       |  PostgreSQL             |
|                  |       |   - Feature flags    |       |  - Journal entries      |
+------------------+       |   - Request routing  |       |  - User profiles        |
                           |                     |       |  - Analysis cache       |
+------------------+       |                     |       |  - Session data         |
|                  |       |                     |       +-------------------------+
|  Power Automate  +------>+                     |
|  Flows           |       |                     +------>+-------------------------+
|  (Scheduled /    |       |                     |       |                         |
|   Triggered)     |       |                     |       |  Microsoft Graph API    |
+------------------+       |                     |       |  - Calendar events      |
                           |                     |       |  - User profile         |
                           +----------+----------+       |  - Teams presence       |
                                      |                  +-------------------------+
                                      |
                                      v
                           +---------------------+
                           |                     |
                           |  Dataverse           |
                           |  - Synced entries    |
                           |  - Analytics data    |
                           |  - Power BI source   |
                           +---------------------+
```

## Component Descriptions

### Web Frontend
- **Technology**: React single-page application
- **Purpose**: Primary user interface for journaling, reviewing analysis, and interacting with the AI coach
- **Authentication**: Azure AD via MSAL.js; acquires tokens for the Express API
- **Hosting**: Azure Static Web Apps or any static hosting provider

### Express API
- **Technology**: Node.js with Express framework
- **Purpose**: Central backend handling all business logic, authentication, and external service orchestration
- **Key Middleware**: Azure AD JWT validation, rate limiting, request logging, feature flag evaluation
- **Hosting**: Azure App Service (Linux) or any Node.js-compatible host

### Azure AD Authentication
- **Purpose**: Identity provider for all authentication flows
- **App Registration**: Single registration with exposed API scopes (`Journal.ReadWrite`, `Analysis.Read`)
- **Supported Flows**: Authorization Code (web), On-Behalf-Of (Copilot Studio), Client Credentials (Power Automate)

### Microsoft Graph Integration
- **Purpose**: Enrich journal context with Microsoft 365 data
- **Capabilities**: Read calendar events for context, retrieve user profile information, detect Teams presence status
- **Authentication**: On-Behalf-Of flow using delegated permissions

### Dataverse Sync
- **Purpose**: Mirror journal metadata and analytics into Dataverse for Power Platform consumption
- **Sync Direction**: One-way from PostgreSQL to Dataverse (scheduled via Power Automate)
- **Tables**: `clearmind_journalentries`, `clearmind_analysisresults`, `clearmind_usersettings`

### Power Automate
- **Purpose**: Scheduled and event-driven automation workflows
- **Flows**: Daily recap generation, weekly summary emails, Dataverse sync, calendar-based journal prompts
- **Trigger Types**: Scheduled (recurrence), HTTP webhook, Dataverse record creation

### Copilot Studio
- **Purpose**: Conversational AI interface accessible via Microsoft Teams and web chat
- **Topics**: Create entry, search entries, get coaching, view recap, mood check-in
- **Connector**: Custom connector using the ClearMind AI OpenAPI specification

### Groq LLM
- **Model**: Llama 3 (via Groq API for fast inference)
- **Purpose**: Powers all AI features including mood analysis, sentiment scoring, theme extraction, coaching, and recap generation
- **Configuration**: Temperature 0.7 for coaching, 0.3 for analysis, 0.5 for recaps

## Data Flow Descriptions

### Web Session Authentication Path
1. User opens the React web app and clicks "Sign In"
2. MSAL.js redirects to Azure AD login page
3. User authenticates; Azure AD returns an authorization code
4. MSAL.js exchanges the code for an access token (audience: `api://{client-id}`)
5. React app includes the access token in the `Authorization: Bearer` header on all API calls
6. Express API validates the JWT signature, issuer, audience, and expiration
7. User ID is extracted from the token claims and used for all database queries

### Copilot Studio Bearer Authentication Path
1. User interacts with the Copilot Studio bot in Teams or web chat
2. Copilot Studio topic triggers a custom connector action (e.g., "Search Entries")
3. The custom connector authenticates via OAuth2 using the configured Azure AD connection
4. An access token is obtained on behalf of the user (On-Behalf-Of flow)
5. The connector sends the request to the Express API with the Bearer token
6. Express API validates the token identically to the web path
7. Response flows back through the connector to the Copilot Studio topic, which formats it for the user

### Power Automate Webhook Path
1. A Power Automate flow triggers on a schedule (e.g., daily at 8:00 AM) or via an HTTP webhook
2. The flow authenticates using Client Credentials (app-only) with the ClearMind API custom connector
3. The flow calls the Express API endpoint (e.g., `GET /api/recap?period=daily`)
4. Express API validates the app-only token and processes the request
5. The response is returned to Power Automate
6. The flow performs follow-up actions: send an adaptive card via Teams, write to Dataverse, or trigger an email via Outlook connector

## Feature Flags

| Flag | Default | Description |
|------|---------|-------------|
| `ENABLE_MOOD_ANALYSIS` | `true` | Enable automatic mood and sentiment analysis on new journal entries |
| `ENABLE_COACHING` | `true` | Enable the AI coaching chat feature |
| `ENABLE_RECAP` | `true` | Enable daily, weekly, and monthly recap generation |
| `ENABLE_SEARCH` | `true` | Enable semantic search across journal entries |
| `ENABLE_GRAPH_INTEGRATION` | `false` | Enable Microsoft Graph calendar and presence enrichment |
| `ENABLE_DATAVERSE_SYNC` | `false` | Enable syncing journal metadata to Dataverse tables |
| `ENABLE_CRISIS_DETECTION` | `true` | Enable automatic detection of crisis-related language with resource display |
| `ENABLE_EXPORT` | `true` | Enable journal entry export (JSON, PDF) |
| `ENABLE_TEAMS_NOTIFICATIONS` | `false` | Enable proactive Teams notifications for journal prompts and recaps |
| `ENABLE_POWER_AUTOMATE_WEBHOOKS` | `false` | Enable webhook endpoints for Power Automate flow triggers |
