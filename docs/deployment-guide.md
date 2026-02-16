# ClearMind AI - Deployment Guide

## Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Azure AD App Registration](#2-azure-ad-app-registration)
3. [Deploy Express API](#3-deploy-express-api-to-azure-app-service)
4. [Import Custom Connector](#4-import-custom-connector-into-power-platform)
5. [Create Copilot Studio Bot](#5-create-copilot-studio-bot)
6. [Set Up Power Automate Flows](#6-set-up-power-automate-flows)
7. [Publish to Teams](#7-publish-to-teams)
8. [Post-Deployment Verification](#8-post-deployment-verification-checklist)

---

## 1. Prerequisites

Before starting deployment, ensure you have the following:

- **Azure Subscription** with permissions to create App Registrations, App Services, and Azure Database for PostgreSQL
- **Node.js 18+** installed locally for build steps
- **PostgreSQL 14+** instance (Azure Database for PostgreSQL Flexible Server recommended)
- **Power Platform license** with Copilot Studio entitlement (per-user or per-tenant)
- **Groq API key** from [console.groq.com](https://console.groq.com)
- **Azure CLI** installed and authenticated (`az login`)
- **Power Platform CLI** (optional, for connector import via CLI)
- **Git** for cloning the repository

## 2. Azure AD App Registration

### 2.1 Register the Application

1. Navigate to [Azure Portal](https://portal.azure.com) > Azure Active Directory > App registrations
2. Click **New registration**
3. Configure:
   - **Name**: `ClearMind AI`
   - **Supported account types**: Accounts in this organizational directory only (Single tenant)
   - **Redirect URI**: Add the following:
     - Web: `https://your-app.azurewebsites.net/auth/callback`
     - SPA: `https://your-frontend-url.com`
     - Web: `https://global.consent.azure-apim.net/redirect` (for Power Platform connector)
4. Click **Register**
5. Note the **Application (client) ID** and **Directory (tenant) ID**

### 2.2 Add API Permissions

1. Go to **API permissions** > **Add a permission**
2. Add the following Microsoft Graph delegated permissions:
   - `User.Read` (sign in and read user profile)
   - `Calendars.Read` (optional, for Graph integration)
3. Click **Grant admin consent** for your organization

### 2.3 Expose an API

1. Go to **Expose an API**
2. Set the **Application ID URI** to `api://{your-client-id}`
3. Add the following scopes:
   - **Scope name**: `Journal.ReadWrite`
     - Who can consent: Admins and users
     - Admin consent display name: Read and write journal entries
     - Admin consent description: Allows the app to read and write journal entries on behalf of the signed-in user
   - **Scope name**: `Analysis.Read`
     - Who can consent: Admins and users
     - Admin consent display name: Read analysis results
     - Admin consent description: Allows the app to read AI analysis results on behalf of the signed-in user
4. Under **Authorized client applications**, add:
   - Power Platform first-party app ID: `00000007-0000-0000-c000-000000000000`
   - Authorized scopes: Select both `Journal.ReadWrite` and `Analysis.Read`

### 2.4 Create a Client Secret

1. Go to **Certificates & secrets** > **New client secret**
2. Description: `ClearMind API Secret`
3. Expiration: 24 months (set a calendar reminder to rotate)
4. Copy the secret **Value** immediately (it will not be shown again)

## 3. Deploy Express API to Azure App Service

### 3.1 Create Azure Resources

```bash
# Set variables
RESOURCE_GROUP="rg-clearmind"
LOCATION="eastus"
APP_NAME="clearmind-api"
PG_SERVER="clearmind-db"

# Create resource group
az group create --name $RESOURCE_GROUP --location $LOCATION

# Create PostgreSQL Flexible Server
az postgres flexible-server create \
  --resource-group $RESOURCE_GROUP \
  --name $PG_SERVER \
  --location $LOCATION \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --admin-user clearmindadmin \
  --admin-password '<strong-password>' \
  --storage-size 32

# Create the database
az postgres flexible-server db create \
  --resource-group $RESOURCE_GROUP \
  --server-name $PG_SERVER \
  --database-name clearmind

# Create App Service Plan
az appservice plan create \
  --name "${APP_NAME}-plan" \
  --resource-group $RESOURCE_GROUP \
  --sku B1 \
  --is-linux

# Create Web App
az webapp create \
  --resource-group $RESOURCE_GROUP \
  --plan "${APP_NAME}-plan" \
  --name $APP_NAME \
  --runtime "NODE:18-lts"
```

### 3.2 Configure Environment Variables

```bash
az webapp config appsettings set \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --settings \
    NODE_ENV="production" \
    PORT="8080" \
    DATABASE_URL="postgresql://clearmindadmin:<password>@${PG_SERVER}.postgres.database.azure.com:5432/clearmind?sslmode=require" \
    AZURE_AD_TENANT_ID="{your-tenant-id}" \
    AZURE_AD_CLIENT_ID="{your-client-id}" \
    AZURE_AD_CLIENT_SECRET="{your-client-secret}" \
    AZURE_AD_AUDIENCE="api://{your-client-id}" \
    GROQ_API_KEY="{your-groq-api-key}" \
    GROQ_MODEL="llama-3.3-70b-versatile" \
    ENABLE_MOOD_ANALYSIS="true" \
    ENABLE_COACHING="true" \
    ENABLE_RECAP="true" \
    ENABLE_SEARCH="true" \
    ENABLE_GRAPH_INTEGRATION="false" \
    ENABLE_DATAVERSE_SYNC="false" \
    ENABLE_CRISIS_DETECTION="true"
```

### 3.3 Deploy the Application

```bash
# From the project root directory
cd journal-app

# Install dependencies and build
npm ci --production

# Deploy via ZIP deploy
zip -r deploy.zip . -x "node_modules/.cache/*" ".git/*" "docs/*"
az webapp deploy \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --src-path deploy.zip \
  --type zip

# Run database migrations
az webapp ssh --resource-group $RESOURCE_GROUP --name $APP_NAME
# In SSH session: node migrate.js
```

### 3.4 Verify API Deployment

```bash
# Health check
curl https://${APP_NAME}.azurewebsites.net/api/health

# Expected response:
# {"status":"healthy","version":"1.0.0","database":"connected","features":{...}}
```

## 4. Import Custom Connector into Power Platform

### 4.1 Prepare the OpenAPI Specification

1. Open `copilot-studio/connector/apiDefinition.swagger.json`
2. Replace all placeholder values:
   - `your-app.azurewebsites.net` with your actual App Service hostname
   - `{tenant-id}` with your Azure AD tenant ID
   - `{your-client-id}` with your Azure AD application client ID

### 4.2 Import into Power Platform

1. Navigate to [make.powerapps.com](https://make.powerapps.com)
2. Select your target environment
3. Go to **Dataverse** > **Custom Connectors** (or **Data** > **Custom Connectors**)
4. Click **New custom connector** > **Import an OpenAPI file**
5. Name: `ClearMind AI`
6. Upload `apiDefinition.swagger.json`
7. On the **Security** tab:
   - Authentication type: OAuth 2.0
   - Identity provider: Azure Active Directory
   - Client ID: `{your-client-id}`
   - Client Secret: `{your-client-secret}`
   - Resource URL: `api://{your-client-id}`
   - Tenant ID: `{your-tenant-id}`
8. Click **Create connector**
9. Go to the **Test** tab > **New connection** to verify authentication works

### 4.3 Test the Connector

1. Create a new connection using your Azure AD credentials
2. Test each operation:
   - `ListEntries` -- should return an empty array or existing entries
   - `CreateEntry` -- create a test entry with title and content
   - `AnalyzeEntry` -- analyze the test entry
   - `SearchEntries` -- search for the test entry
   - `GetCoachingResponse` -- send a test message
   - `GetRecap` -- request a daily recap

## 5. Create Copilot Studio Bot

### 5.1 Create the Bot

1. Navigate to [copilotstudio.microsoft.com](https://copilotstudio.microsoft.com)
2. Select your environment (same one where the connector was imported)
3. Click **Create** > **New copilot**
4. Configure:
   - **Name**: `ClearMind Journal Assistant`
   - **Description**: Helps you journal, reflect, and get AI-powered insights about your mental wellness
   - **Language**: English
   - **Generative AI**: Enable orchestration

### 5.2 Import Topics

Import or manually create the following topics:

**Topic: Create Journal Entry**
- Trigger phrases: "I want to write in my journal", "new journal entry", "log my thoughts", "write an entry"
- Flow: Ask for title (optional) > Ask for content (required) > Call `CreateEntry` via connector > Confirm creation > Offer to analyze

**Topic: Search My Journal**
- Trigger phrases: "search my journal", "find entries about", "when did I write about", "look up"
- Flow: Ask for search query > Call `SearchEntries` via connector > Display top 3 results with snippets

**Topic: Get Coaching**
- Trigger phrases: "I need advice", "coach me", "help me with", "I'm feeling"
- Flow: Capture user message > Call `GetCoachingResponse` via connector > Display response and suggested actions

**Topic: View Recap**
- Trigger phrases: "show my recap", "weekly summary", "how was my week", "monthly recap"
- Flow: Ask for period (daily/weekly/monthly) > Call `GetRecap` via connector > Display summary, mood trend, and themes

**Topic: Mood Check-In**
- Trigger phrases: "mood check", "how am I doing", "check my mood", "mood trend"
- Flow: Call `GetRecap` with period=weekly > Extract mood trend > Display with supportive message

**Topic: Crisis Escalation** (System)
- Trigger phrases: "I want to hurt myself", "suicidal", "self-harm", "end my life"
- Flow: Display crisis resources immediately > Offer to connect with human support > Do NOT pass to AI coach

### 5.3 Configure the Connector

1. In each topic that calls the API, add a **Call an action** node
2. Select the ClearMind AI connector
3. Map topic variables to connector input parameters
4. Map connector output to response variables for display in messages

## 6. Set Up Power Automate Flows

### 6.1 Daily Recap Flow

1. Navigate to [make.powerautomate.com](https://make.powerautomate.com)
2. Create a new **Scheduled cloud flow**
3. Configure:
   - **Name**: `ClearMind - Daily Recap`
   - **Schedule**: Every day at 8:00 PM (user's timezone)
4. Flow steps:
   - **Trigger**: Recurrence (daily)
   - **Action**: ClearMind AI connector > `GetRecap` (period: "daily")
   - **Condition**: Check if `entryCount > 0`
   - **If yes**: Send an Adaptive Card via Teams with the recap summary
   - **If no**: Send a gentle prompt encouraging journaling

### 6.2 Weekly Summary Email Flow

1. Create a new **Scheduled cloud flow**
2. Configure:
   - **Name**: `ClearMind - Weekly Summary`
   - **Schedule**: Every Monday at 9:00 AM
3. Flow steps:
   - **Trigger**: Recurrence (weekly)
   - **Action**: ClearMind AI connector > `GetRecap` (period: "weekly")
   - **Action**: Send an email via Outlook connector with formatted summary

### 6.3 Dataverse Sync Flow

1. Create a new **Scheduled cloud flow**
2. Configure:
   - **Name**: `ClearMind - Dataverse Sync`
   - **Schedule**: Every 6 hours
3. Flow steps:
   - **Trigger**: Recurrence
   - **Action**: ClearMind AI connector > `ListEntries` (with `startDate` = 6 hours ago)
   - **Apply to each**: For each entry, upsert into Dataverse `clearmind_journalentries` table
   - **Error handling**: Configure retry policy (3 retries, exponential backoff)

### 6.4 Import Flow Definitions

If flow definition JSON files are provided in `copilot-studio/flows/`:

1. Go to **My flows** > **Import** > **Import Package**
2. Upload the `.zip` flow package
3. Configure connections: map the ClearMind AI connector connection and any other connectors (Teams, Outlook)
4. Click **Import**

## 7. Publish to Teams

### 7.1 Publish the Copilot

1. In Copilot Studio, open the `ClearMind Journal Assistant` bot
2. Click **Publish** in the top-right corner
3. Wait for the publish process to complete

### 7.2 Add to Microsoft Teams

1. Go to **Channels** in the left sidebar
2. Click **Microsoft Teams**
3. Click **Turn on Teams**
4. Configure:
   - **Bot display name**: ClearMind
   - **Short description**: AI-powered journaling companion
   - **Long description**: Journal your thoughts, get mood analysis, receive coaching, and review weekly recaps -- all within Teams
5. Click **Availability options**:
   - Select **Show to my teammates and shared users** for testing
   - Or **Submit for admin approval** for organization-wide deployment

### 7.3 Configure Teams App Permissions

1. In the [Teams Admin Center](https://admin.teams.microsoft.com):
   - Go to **Teams apps** > **Manage apps**
   - Search for `ClearMind`
   - Set **Status** to **Allowed**
2. Configure app setup policies if needed to pin the app for specific user groups

### 7.4 Test in Teams

1. Open Microsoft Teams
2. Search for `ClearMind` in the app store or chat
3. Start a conversation and test each topic:
   - "I want to write in my journal"
   - "Search my journal for stress"
   - "How was my week?"
   - "I need some coaching"

## 8. Post-Deployment Verification Checklist

### API Health
- [ ] `GET /api/health` returns `{"status":"healthy"}` with HTTP 200
- [ ] Database connection is active (check health response `database` field)
- [ ] All feature flags are set correctly in App Service configuration

### Authentication
- [ ] Web frontend can sign in and acquire a token
- [ ] API rejects requests without a valid Bearer token (HTTP 401)
- [ ] API rejects tokens with wrong audience
- [ ] Custom connector can authenticate and call all operations
- [ ] Power Automate flows can authenticate via the connector

### Core API Endpoints
- [ ] `POST /api/entries` creates an entry and returns HTTP 201
- [ ] `GET /api/entries` returns a list of entries
- [ ] `GET /api/entries/{id}` returns a single entry
- [ ] `PUT /api/entries/{id}` updates an entry
- [ ] `DELETE /api/entries/{id}` deletes an entry
- [ ] `POST /api/entries/{id}/analyze` returns analysis results
- [ ] `GET /api/search?q=test` returns search results
- [ ] `POST /api/coach` returns a coaching response
- [ ] `GET /api/recap?period=daily` returns a recap

### Copilot Studio
- [ ] Bot responds to all trigger phrases
- [ ] Create Entry topic successfully calls the API and confirms creation
- [ ] Search topic returns and displays results
- [ ] Coaching topic provides a response with suggested actions
- [ ] Recap topic shows summary, mood trend, and themes
- [ ] Crisis escalation topic displays resources without calling the AI coach

### Power Automate
- [ ] Daily recap flow runs successfully on schedule
- [ ] Weekly summary flow sends email with correct content
- [ ] Dataverse sync flow upserts records without errors
- [ ] Retry policies are configured for all API actions

### Teams Integration
- [ ] Bot appears in Teams app store (for authorized users)
- [ ] All topics work correctly within the Teams chat interface
- [ ] Adaptive Cards render properly in Teams
- [ ] Bot responds within 5 seconds for simple operations

### Security
- [ ] HTTPS is enforced on the App Service (HTTP redirect enabled)
- [ ] Database connection uses SSL (`sslmode=require`)
- [ ] Client secret is stored in App Service settings (not in code)
- [ ] CORS is configured to allow only trusted origins
- [ ] Rate limiting is active on API endpoints
