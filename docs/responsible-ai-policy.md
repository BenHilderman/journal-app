# ClearMind AI - Responsible AI Policy

## Table of Contents
1. [Content Moderation](#1-content-moderation)
2. [PII Handling](#2-pii-handling)
3. [Data Retention](#3-data-retention)
4. [Audit Logging](#4-audit-logging)
5. [Model Transparency](#5-model-transparency)
6. [Bias Mitigation](#6-bias-mitigation)
7. [User Consent](#7-user-consent)
8. [Escalation Protocol](#8-escalation-protocol)

---

## 1. Content Moderation

### Crisis Detection

ClearMind AI includes an automatic crisis detection system that identifies language indicating potential self-harm, suicidal ideation, or immediate danger.

**How It Works**:
- Every journal entry and coaching message is scanned for crisis-related language before AI analysis
- Detection uses a combination of keyword matching and contextual LLM evaluation to reduce false positives
- When crisis language is detected, the system immediately interrupts the normal flow

**Copilot Studio Escalation Topic**:
- A dedicated "Crisis Escalation" topic is configured with the highest priority
- Trigger phrases include explicit crisis language and subtle indicators
- The topic immediately displays crisis resources without routing through the AI coach
- Resources displayed:
  - National Suicide Prevention Lifeline: 988 (call or text)
  - Crisis Text Line: Text HOME to 741741
  - International Association for Suicide Prevention: https://www.iasp.info/resources/Crisis_Centres/
- The topic offers to connect the user with a human support resource
- The conversation is flagged for admin review (no content is stored in the flag, only the occurrence)

**Feature Flag**: `ENABLE_CRISIS_DETECTION` (default: `true`). This flag must never be disabled in production.

### Inappropriate Content Filtering

- Journal entries are private and personal; content filtering is minimal to respect user autonomy
- The AI coach will not generate harmful, violent, or explicitly sexual content in responses
- If a user's message to the coach contains content that the LLM cannot safely respond to, the system returns a message redirecting to professional resources
- The system does not censor or modify user journal entries; users have full freedom to express themselves

---

## 2. PII Handling

### No PII in Logs

- Application logs (stdout, Application Insights traces, Power Automate run history) must never contain personally identifiable information
- The following are explicitly excluded from all log output:
  - Journal entry content (title, body text)
  - User email addresses and display names
  - Coaching conversation messages
  - Search queries
  - AI analysis text (mood labels and numeric scores are permitted)
- Logs may contain:
  - Anonymous user IDs (opaque identifiers, not email)
  - Entry IDs (UUIDs)
  - Timestamps
  - HTTP status codes and response times
  - Feature flag states
  - Error codes and stack traces (sanitized of user data)

### Encryption at Rest

- PostgreSQL database uses Azure-managed encryption at rest (AES-256)
- Dataverse data is encrypted at rest by the Power Platform infrastructure
- Application Insights data is encrypted at rest by Azure Monitor
- No journal content is stored in plain text in any log, cache, or temporary file

### Encryption in Transit

- All API communication is over HTTPS (TLS 1.2+)
- Database connections use SSL (`sslmode=require`)
- Groq API calls are made over HTTPS
- Microsoft Graph calls are made over HTTPS

### User Data Deletion

- Users may request deletion of all their data at any time
- Deletion request process:
  1. User submits a deletion request via the web app or by contacting support
  2. The system deletes all journal entries, analysis results, coaching history, and user settings from PostgreSQL within 72 hours
  3. Corresponding Dataverse records are deleted in the next sync cycle
  4. Application Insights telemetry containing the user's anonymous ID is retained for the standard retention period but contains no PII
  5. The user receives confirmation when deletion is complete
- Deletion is permanent and irreversible; users are warned before confirming

---

## 3. Data Retention

### Default Retention Policy

- **Journal entries**: Retained indefinitely while the user account is active
- **Analysis results**: Retained for 90 days, then automatically archived or deleted based on user preference
- **Coaching conversation history**: Retained for 90 days, then automatically deleted
- **Recap summaries**: Retained for 90 days, then automatically deleted
- **Session data**: Retained for 30 days

### Configurable Retention

- Users can configure their retention period in account settings:
  - 30 days, 60 days, 90 days (default), 180 days, 1 year, or indefinite
  - Setting applies to analysis results, coaching history, and recaps
  - Journal entries are always retained unless explicitly deleted by the user
- Administrators can set organization-wide retention policies that override individual user settings

### GDPR Compliance

- **Right to Access**: Users can export all their data in JSON format via the web app or API (`GET /api/export`)
- **Right to Rectification**: Users can edit any journal entry at any time
- **Right to Erasure**: Users can delete individual entries or request full account deletion (see PII Handling)
- **Right to Data Portability**: Export includes all entries, analysis results, and coaching history in a standard JSON format
- **Data Processing Agreement**: Available upon request for organizations deploying ClearMind AI
- **Data Residency**: Data is stored in the Azure region specified during deployment; no cross-region transfer unless explicitly configured

---

## 4. Audit Logging

### What Is Logged

Every API call is logged with the following fields:

| Field | Description | Example |
|-------|-------------|---------|
| `timestamp` | ISO 8601 timestamp of the request | `2026-02-15T14:30:00.000Z` |
| `userId` | Opaque anonymous user identifier | `a1b2c3d4-e5f6-...` |
| `action` | The API operation performed | `CreateEntry`, `AnalyzeEntry`, `Search` |
| `endpoint` | HTTP method and path | `POST /api/entries` |
| `statusCode` | HTTP response status code | `201` |
| `duration` | Request processing time in milliseconds | `245` |
| `source` | Request origin | `web`, `copilot-studio`, `power-automate` |
| `featureFlags` | Active feature flags for the request | `{moodAnalysis: true, ...}` |

### What Is NOT Logged

- Journal entry content (title, body, tags)
- Coaching messages (user input or AI response)
- Search query text
- Analysis result text (themes, suggestions)
- Any personally identifiable information (name, email)

### Log Storage and Access

- Audit logs are stored in Application Insights with a 90-day retention period
- Logs are accessible to administrators via the Azure Portal (Log Analytics workspace)
- Log access is restricted to the `ClearMind-Admins` Azure AD security group
- All log access is itself audited via Azure AD sign-in and audit logs

### Compliance Reporting

- Monthly audit reports can be generated from Log Analytics queries
- Reports include: total API calls by action, error rates, unique user counts, feature usage distribution
- Reports contain no PII and can be shared with compliance teams

---

## 5. Model Transparency

### LLM Model Information

| Property | Value |
|----------|-------|
| **Provider** | Groq |
| **Model** | Llama 3.3 70B Versatile (`llama-3.3-70b-versatile`) |
| **Model Type** | Large Language Model (decoder-only transformer) |
| **Training Data Cutoff** | Publicly available data up to the model's training date |
| **Inference Location** | Groq cloud infrastructure (US-based) |

### Temperature Settings

Temperature controls the randomness of the model's output. Lower values produce more consistent, deterministic responses; higher values produce more creative, varied responses.

| Feature | Temperature | Rationale |
|---------|-------------|-----------|
| Mood Analysis | 0.3 | Low variance for consistent, reliable classification |
| Sentiment Scoring | 0.3 | Low variance for reproducible numeric scores |
| Theme Extraction | 0.5 | Moderate creativity for identifying diverse themes |
| Coaching Responses | 0.7 | Higher creativity for empathetic, personalized guidance |
| Recap Generation | 0.5 | Balanced for readable yet accurate summaries |
| Search Relevance | 0.2 | Very low for consistent ranking |

### System Prompts

- All system prompts used for mood analysis, coaching, and recap generation are version-controlled in the repository
- System prompts explicitly instruct the model to:
  - Not provide medical diagnoses or treatment recommendations
  - Not claim to be a therapist, counselor, or medical professional
  - Recommend professional help when appropriate
  - Acknowledge the limitations of AI analysis
  - Respond with cultural sensitivity and inclusivity

### Model Updates

- When the Groq model version changes, the change is documented in the release notes
- Model changes require regression testing against a standardized evaluation set before production deployment
- Users are notified of significant model changes that may affect analysis quality

---

## 6. Bias Mitigation

### Mood Analysis Review

- Mood classification has been reviewed for cultural sensitivity:
  - Mood categories are designed to be universally understood across cultures
  - The system avoids pathologizing normal emotional states
  - Sentiment scoring accounts for cultural differences in emotional expression (e.g., indirect expression of distress)
- Regular bias audits are conducted:
  - Quarterly review of mood classification accuracy across demographic groups (where demographic data is voluntarily provided)
  - Analysis of false-positive rates for crisis detection across different writing styles
  - Review of coaching response quality for diverse user populations

### Inclusive Prompt Design

- All LLM prompts are designed to be inclusive:
  - Gender-neutral language throughout
  - No assumptions about family structure, relationships, or lifestyle
  - Culturally neutral examples and suggestions
  - Support for multiple languages (future roadmap)
- Prompts explicitly instruct the model to:
  - Avoid stereotypes based on gender, race, ethnicity, religion, or sexual orientation
  - Respect diverse cultural approaches to mental wellness
  - Recognize that emotional expression varies across cultures and individuals

### Continuous Improvement

- User feedback on coaching responses is analyzed for bias patterns
- System prompts are updated based on bias audit findings
- External reviewers may be engaged for annual bias assessments

---

## 7. User Consent

### Disclosure

- Users are clearly informed that ClearMind AI uses artificial intelligence to analyze journal content
- The disclosure is presented:
  - During first-time setup (onboarding flow in both web app and Copilot Studio)
  - In the application's About/Privacy section (always accessible)
  - In the Copilot Studio bot's greeting topic

### Disclosure Content

Users are informed of the following:

1. **AI Analysis**: Journal entries are analyzed by an AI model (Llama 3.3 via Groq) to detect mood, sentiment, and themes
2. **Data Processing**: Entry content is sent to the Groq API for processing; Groq does not retain the data after processing
3. **Coaching**: The AI coach provides supportive guidance but is not a substitute for professional mental health care
4. **Data Storage**: Entries and analysis results are stored in the application's database (encrypted at rest)
5. **No Human Review**: Journal content is not reviewed by humans unless a crisis escalation is triggered and the user consents to human follow-up
6. **Feature Control**: Users can disable individual AI features (mood analysis, coaching, recaps) at any time

### Opt-In Model

- All AI-powered features require explicit opt-in:
  - Mood analysis: opt-in during onboarding, toggleable in settings
  - Coaching: opt-in on first use, toggleable in settings
  - Recap generation: opt-in during onboarding, toggleable in settings
  - Microsoft Graph integration: separate opt-in with clear explanation of data accessed
- Users can opt out of any feature at any time without losing their existing data
- Opting out stops future analysis but does not delete past analysis results (users can delete those separately)

---

## 8. Escalation Protocol

### Automatic Crisis Resource Display

When crisis-related language is detected:

1. **Immediate Response**: The system immediately displays crisis resources (see Content Moderation section)
2. **No AI Processing**: The user's message is NOT sent to the AI coach or LLM for analysis
3. **Resource Persistence**: Crisis resources remain visible and are not replaced by other content
4. **No Minimization**: The system does not attempt to assess the severity of the crisis; all detections are treated with equal urgency

### Human Handoff Option

- After displaying crisis resources, the system offers the user the option to connect with a human
- Human handoff options (configurable per organization):
  - Transfer to a designated support contact (email or Teams chat)
  - Provide a link to the organization's Employee Assistance Program (EAP)
  - Display a phone number for the organization's wellness team
- The user is never forced into a human handoff; the option is always voluntary

### No Therapeutic Claims

ClearMind AI explicitly does not:

- Claim to provide therapy, counseling, or medical advice
- Diagnose mental health conditions
- Recommend specific medications or treatments
- Replace professional mental health care
- Guarantee any health outcomes

All coaching responses include a footer disclaimer:
> "ClearMind AI provides supportive guidance and is not a substitute for professional mental health care. If you are in crisis, please contact emergency services or a crisis hotline."

### Crisis Event Handling

When a crisis is detected:

1. A `CrisisDetected` event is logged in Application Insights (timestamp and anonymous user ID only; no content)
2. If configured, a notification is sent to the designated admin contact
3. The admin can review the event and take organizational action (e.g., outreach via EAP) without accessing the user's journal content
4. All crisis events are reviewed in the weekly operations meeting
5. False positive rates are tracked and used to improve detection accuracy

### Organizational Customization

Organizations deploying ClearMind AI can customize:

- Crisis resource phone numbers and URLs (localized for region)
- Human handoff contact information
- Whether admin notifications are sent on crisis detection
- Additional trigger phrases for crisis detection
- Post-crisis follow-up workflow (via Power Automate)
