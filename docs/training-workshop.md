# ClearMind AI - Training Workshop

## 2-Day Workshop: Building and Managing AI-Powered Solutions with Copilot Studio and Power Automate

**Duration**: 2 days (8 hours total, 4 hours per day)
**Audience**: IT administrators, citizen developers, Power Platform makers
**Delivery**: Instructor-led with hands-on labs

---

## Day 1: Copilot Studio Fundamentals (4 hours)

### Module 1: Platform Overview and Architecture (45 minutes)

**Learning Objectives**
- Understand the ClearMind AI system architecture and how all components interact
- Identify the role of each Microsoft platform service (Azure AD, Copilot Studio, Power Automate, Dataverse)
- Explain the three authentication paths (web session, Copilot Studio bearer, Power Automate webhook)

**Prerequisites**
- Basic understanding of REST APIs and HTTP
- Familiarity with Azure Active Directory concepts (tenants, app registrations)
- Access to a Microsoft 365 tenant with Power Platform licenses

**Materials Needed**
- Architecture overview document (architecture-overview.md)
- Slide deck: "ClearMind AI Platform Architecture"
- Whiteboard or digital collaboration space

**Topics Covered**
1. Introduction to the ClearMind AI journaling platform
2. Walkthrough of the architecture diagram: user touchpoints, API layer, AI services, data stores
3. Authentication and authorization model
   - Azure AD app registration and scopes
   - Token flow for each integration path
4. Feature flags and configuration management
5. Q&A and discussion: how this architecture applies to other AI-powered solutions

---

### Module 2: Topics and Trigger Phrases (45 minutes)

**Learning Objectives**
- Create and configure Copilot Studio topics with appropriate trigger phrases
- Design conversation flows with branching logic, variable capture, and conditional responses
- Apply best practices for natural language trigger phrase design

**Prerequisites**
- Completion of Module 1
- Access to Copilot Studio environment

**Materials Needed**
- Copilot Studio environment with ClearMind bot pre-deployed
- Reference card: ClearMind bot topic list with trigger phrases
- Slide deck: "Designing Conversational Topics"

**Topics Covered**
1. Anatomy of a Copilot Studio topic: trigger phrases, conversation nodes, variables
2. Walkthrough of ClearMind topics
   - Create Journal Entry topic: capturing multi-line input, optional fields
   - Search topic: extracting search intent from natural language
   - Coaching topic: maintaining conversation context
3. Trigger phrase design principles
   - Minimum 5-8 trigger phrases per topic
   - Cover variations: formal, informal, question form, command form
   - Avoid overlap between topics
4. Conversation flow design
   - Question nodes with entity extraction
   - Condition nodes for branching logic
   - Message nodes with adaptive cards
5. Testing topics in the authoring canvas

---

### Module 3: Custom Connectors and API Integration (90 minutes)

**Learning Objectives**
- Import and configure a custom connector from an OpenAPI specification
- Understand OAuth2 authentication configuration for custom connectors
- Call custom connector actions from within Copilot Studio topics
- Handle API responses and errors in conversation flows

**Prerequisites**
- Completion of Modules 1 and 2
- Understanding of OpenAPI/Swagger specification format
- ClearMind API deployed and accessible

**Materials Needed**
- `apiDefinition.swagger.json` and `apiProperties.json` files
- Deployed ClearMind API endpoint URL
- Azure AD app registration credentials (client ID, secret, tenant ID)
- Slide deck: "Custom Connectors Deep Dive"

**Topics Covered**
1. What is a custom connector and when to use one
   - Built-in connectors vs. custom connectors
   - Connector certification process overview
2. Walkthrough: OpenAPI specification for the ClearMind API
   - Paths, operations, parameters, and schemas
   - `x-ms-visibility` annotations and their impact on the UI
   - Security definitions for OAuth2
3. Hands-on: Import the ClearMind connector
   - Upload the OpenAPI spec
   - Configure OAuth2 security settings
   - Test the connection and individual operations
4. Integrating the connector with Copilot Studio
   - Adding "Call an action" nodes to topics
   - Mapping topic variables to connector parameters
   - Parsing JSON responses and displaying results
5. Error handling strategies
   - Timeout and retry configuration
   - Fallback messages when the API is unavailable
   - Graceful degradation patterns
6. Connector management: versioning, updating, and sharing

---

### Module 4: Hands-On Lab -- Build a Simple Topic (60 minutes)

**Learning Objectives**
- Build a complete Copilot Studio topic from scratch
- Integrate the ClearMind API custom connector in a topic
- Test and iterate on the topic design

**Prerequisites**
- Completion of Modules 1-3
- Custom connector imported and tested

**Materials Needed**
- Copilot Studio environment with ClearMind connector available
- Lab instruction sheet with step-by-step guidance
- Solution reference for comparison

**Lab Exercise: Build a "Mood Check-In" Topic**

1. **Create the topic** (10 min)
   - Add trigger phrases: "check my mood", "how am I doing", "mood update", "how have I been feeling"
   - Add a greeting message acknowledging the user's request

2. **Call the API** (15 min)
   - Add a "Call an action" node using the ClearMind connector
   - Call `GetRecap` with period set to "weekly"
   - Store the response in a variable

3. **Build the response** (15 min)
   - Extract `moodTrend`, `averageSentiment`, and `keyThemes` from the response
   - Create a formatted message showing the mood summary
   - Add conditional logic: if sentiment < 0, offer coaching; if sentiment > 0.5, display encouragement

4. **Add follow-up options** (10 min)
   - Offer buttons: "Get coaching", "View full recap", "Write a new entry"
   - Redirect to the appropriate topic based on selection

5. **Test and refine** (10 min)
   - Test the topic in the authoring canvas
   - Try different trigger phrases
   - Verify API integration works end-to-end

---

## Day 2: Power Automate and Governance (4 hours)

### Module 5: Power Automate Cloud Flows (60 minutes)

**Learning Objectives**
- Create scheduled and trigger-based cloud flows using the ClearMind connector
- Configure flow actions, conditions, loops, and error handling
- Design flows that bridge Copilot Studio and external systems (Teams, Outlook, Dataverse)

**Prerequisites**
- Completion of Day 1 modules
- Basic familiarity with Power Automate interface
- Access to Power Automate environment

**Materials Needed**
- Power Automate environment in the same tenant
- ClearMind connector connection pre-configured
- Slide deck: "Power Automate for ClearMind"
- Flow templates (JSON exports) for reference

**Topics Covered**
1. Power Automate overview: triggers, actions, connectors, and flow types
2. Walkthrough: ClearMind flow architecture
   - Daily recap flow: scheduled trigger, API call, Teams adaptive card
   - Weekly summary flow: scheduled trigger, API call, Outlook email
   - Dataverse sync flow: scheduled trigger, list entries, upsert loop
3. Building a flow step-by-step
   - Configuring the ClearMind connector action
   - Parsing JSON responses with the "Parse JSON" action
   - Composing adaptive cards for Teams notifications
4. Error handling and reliability
   - Configure retry policies (count, interval, backoff)
   - "Configure run after" for failure branches
   - Scope blocks for try-catch patterns
5. Flow optimization
   - Concurrency control for parallel processing
   - Pagination handling for large datasets
   - Variable scoping and initialization

---

### Module 6: Dataverse Integration (45 minutes)

**Learning Objectives**
- Understand the Dataverse data model for ClearMind (tables, columns, relationships)
- Configure Dataverse sync flows to mirror journal data
- Query Dataverse from Copilot Studio and Power Automate

**Prerequisites**
- Completion of Module 5
- Access to a Dataverse environment
- Basic understanding of relational data concepts

**Materials Needed**
- Dataverse environment with ClearMind tables pre-created
- Table schema reference document
- Slide deck: "Dataverse Integration Patterns"

**Topics Covered**
1. Why Dataverse: Power Platform native data store, security roles, audit logging
2. ClearMind Dataverse schema
   - `clearmind_journalentries`: entry metadata (no full content for privacy)
   - `clearmind_analysisresults`: mood, sentiment, themes
   - `clearmind_usersettings`: user preferences and feature flags
3. Sync strategies
   - Scheduled incremental sync (pull new/updated entries)
   - Webhook-based real-time sync (push on entry creation)
   - Conflict resolution: API is source of truth
4. Using Dataverse data in Power Platform
   - Copilot Studio: query Dataverse directly for lightweight lookups
   - Power BI: build dashboards from Dataverse analytics tables
   - Model-driven apps: admin views for support teams
5. Security and row-level access
   - Business units and security roles
   - Ensuring users can only see their own data

---

### Module 7: Security, DLP Policies, and Governance (45 minutes)

**Learning Objectives**
- Configure Data Loss Prevention (DLP) policies to control connector usage
- Implement security best practices for the ClearMind deployment
- Establish governance processes for bot and flow lifecycle management

**Prerequisites**
- Completion of Modules 5-6
- Power Platform admin access (or admin to demonstrate)
- Understanding of organizational data classification

**Materials Needed**
- Power Platform Admin Center access
- Responsible AI policy document (responsible-ai-policy.md)
- Slide deck: "Power Platform Governance for AI Solutions"
- Governance checklist template

**Topics Covered**
1. Data Loss Prevention (DLP) policies
   - What DLP policies control: connector grouping (Business, Non-Business, Blocked)
   - Configuring a DLP policy for the ClearMind connector
   - Ensuring the ClearMind connector is in the "Business" group
   - Preventing data leakage to unauthorized connectors
2. Environment management
   - Development, test, and production environment strategy
   - Solution-aware components: export and import across environments
   - Environment variables for configuration (API URLs, feature flags)
3. Authentication and access control
   - Azure AD Conditional Access policies for the ClearMind API
   - Power Platform environment security roles
   - Connector sharing and connection ownership
4. Responsible AI considerations (overview of responsible-ai-policy.md)
   - Crisis detection and escalation
   - PII handling and data retention
   - User consent and transparency
5. Lifecycle management
   - Version control for bot topics and flows
   - Change management process: dev > test > prod promotion
   - Monitoring and alerting (covered in depth in admin guide)

---

### Module 8: Hands-On Lab -- Build an End-to-End Flow (90 minutes)

**Learning Objectives**
- Build a complete Power Automate flow that integrates with the ClearMind API
- Send formatted results via Teams adaptive card
- Implement error handling and testing

**Prerequisites**
- Completion of all previous modules
- Power Automate environment with ClearMind connector
- Microsoft Teams available for testing

**Materials Needed**
- Power Automate environment
- ClearMind connector connection
- Adaptive card template JSON
- Lab instruction sheet with step-by-step guidance
- Solution reference for comparison

**Lab Exercise: Build a "Journal Prompt and Recap" Flow**

1. **Create the scheduled flow** (10 min)
   - Trigger: Recurrence, daily at 6:00 PM
   - Initialize variables: `promptSent` (boolean), `recapContent` (string)

2. **Check for today's entries** (15 min)
   - Call `ListEntries` with `startDate` = today, `endDate` = today
   - Parse the JSON response
   - Condition: if entry count = 0, set `promptSent` = true

3. **Send a journaling prompt** (15 min)
   - If no entries today, send a Teams adaptive card:
     - Title: "Time to Journal"
     - Body: Motivational prompt with a button linking to the web app
   - If entries exist, proceed to recap

4. **Generate and send the recap** (20 min)
   - Call `GetRecap` with period = "daily"
   - Parse the response
   - Build an adaptive card with:
     - Summary text
     - Mood trend indicator
     - Key themes as bullet points
     - Entry count
   - Send via Teams chat or channel

5. **Add error handling** (15 min)
   - Wrap API calls in a Scope block
   - Add a "Configure run after" branch for failures
   - Send a simplified message if the API is unavailable
   - Add a retry policy (3 attempts, 30-second intervals)

6. **Test the flow** (15 min)
   - Run the flow manually with the "Test" button
   - Verify the Teams message is received and formatted correctly
   - Simulate a failure by temporarily changing the API URL
   - Confirm the error handling branch executes

---

## Workshop Logistics

### Schedule Overview

| Time | Day 1 | Day 2 |
|------|-------|-------|
| 0:00 - 0:45 | Module 1: Platform Overview | Module 5: Power Automate Flows |
| 0:45 - 1:00 | Break | Break |
| 1:00 - 1:45 | Module 2: Topics & Triggers | Module 5 (continued) |
| 1:45 - 2:00 | Break | Break |
| 2:00 - 3:30 | Module 3: Custom Connectors | Module 6: Dataverse (45 min) + Module 7: Governance (45 min) |
| 3:30 - 3:40 | Break | Break |
| 3:40 - 4:40 | Module 4: Hands-On Lab | Module 8: Hands-On Lab |
| 4:40 - 5:00 | Wrap-up & Q&A | Wrap-up, Next Steps & Q&A |

### General Prerequisites (All Participants)
- Laptop with a modern browser (Edge or Chrome recommended)
- Microsoft 365 account with Power Platform access
- Copilot Studio license (trial or paid)
- Pre-provisioned lab environment (provided by instructor)
- Completed pre-reading: architecture-overview.md

### Instructor Preparation
- Deploy ClearMind API to a shared Azure environment
- Import custom connector into each participant's Power Platform environment
- Pre-create Copilot Studio bots with baseline configuration
- Prepare Dataverse tables in the lab environment
- Test all lab exercises end-to-end before the workshop
- Prepare backup slides and demos in case of environment issues
