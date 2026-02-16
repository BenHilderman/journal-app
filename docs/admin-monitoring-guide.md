# ClearMind AI - Admin Monitoring Guide

## Table of Contents
1. [Copilot Studio Analytics](#copilot-studio-analytics)
2. [Power Automate Monitoring](#power-automate-monitoring)
3. [Application Insights Integration](#application-insights-integration)
4. [Key Performance Indicators](#key-performance-indicators)
5. [Alert Configuration](#alert-configuration)

---

## Copilot Studio Analytics

### Accessing Analytics

1. Navigate to [copilotstudio.microsoft.com](https://copilotstudio.microsoft.com)
2. Select the `ClearMind Journal Assistant` bot
3. Click **Analytics** in the left navigation

### Session Metrics

Monitor overall bot usage and engagement:

- **Total Sessions**: Number of unique conversation sessions over the selected period
- **Engagement Rate**: Percentage of sessions where the user interacted beyond the greeting
- **Sessions per User**: Average number of sessions per unique user (indicates repeat usage)
- **Average Session Duration**: Time from first message to last message in a session
- **Peak Usage Hours**: Identify when users are most active (helps schedule maintenance windows)

**Recommended Review Cadence**: Weekly

**What to Look For**:
- Declining session counts may indicate user adoption issues or access problems
- Very short session durations suggest the bot is not meeting user needs
- Sudden spikes may indicate a broadcast or event driving traffic

### Topic Performance

Track how individual topics are performing:

- **Topic Trigger Rate**: How often each topic is triggered relative to total sessions
- **Topic Completion Rate**: Percentage of sessions where the topic flow completed successfully
- **Topic Abandonment Rate**: Percentage of sessions where the user left mid-topic
- **Fallback Rate**: Percentage of user messages that did not match any topic (routed to fallback)

**Key Topics to Monitor**:

| Topic | Target Completion Rate | Action if Below Target |
|-------|----------------------|----------------------|
| Create Journal Entry | > 85% | Review input capture flow; simplify required fields |
| Search My Journal | > 80% | Check API response times; improve result formatting |
| Get Coaching | > 75% | Review coaching prompt quality; check for timeouts |
| View Recap | > 85% | Verify recap API reliability; check for empty recaps |
| Crisis Escalation | 100% (must always complete) | Immediate review if any abandonment detected |

### User Satisfaction

- **CSAT Score**: If satisfaction surveys are enabled, track the average score (1-5 scale)
- **Thumbs Up/Down**: Track positive vs. negative feedback on bot responses
- **Escalation Requests**: Users explicitly asking to speak to a human

**Target**: CSAT >= 4.0, Positive feedback rate >= 70%

### Escalation Rate

- **Definition**: Percentage of sessions that escalate to a human agent or display crisis resources
- **Crisis Escalations**: Tracked separately; any crisis escalation should be reviewed within 24 hours
- **Voluntary Escalations**: Users choosing to leave the bot; analyze the preceding conversation for improvement opportunities

**Target**: Overall escalation rate < 5% (excluding crisis escalations)

---

## Power Automate Monitoring

### Flow Run History

Access flow run history for each ClearMind flow:

1. Navigate to [make.powerautomate.com](https://make.powerautomate.com)
2. Go to **My flows** (or **Team flows** for shared flows)
3. Click on the flow name to view run history

**Key Flows to Monitor**:

| Flow Name | Schedule | Expected Duration | Max Acceptable Duration |
|-----------|----------|-------------------|------------------------|
| ClearMind - Daily Recap | Daily 8:00 PM | < 30 seconds | 2 minutes |
| ClearMind - Weekly Summary | Monday 9:00 AM | < 1 minute | 3 minutes |
| ClearMind - Dataverse Sync | Every 6 hours | < 5 minutes | 15 minutes |

### Flow Run Statuses

- **Succeeded**: Flow completed all actions successfully
- **Failed**: One or more actions failed; review the error details
- **Cancelled**: Flow was manually cancelled or timed out
- **Running**: Flow is currently executing

**Review Process**:
1. Check the flow run history daily for any **Failed** runs
2. Click into failed runs to see which action failed and the error message
3. Common failure causes:
   - API timeout (ClearMind API took too long to respond)
   - Authentication failure (token expired, connector needs reauthorization)
   - Dataverse throttling (too many requests in the sync flow)
   - Teams connector failure (user not found, chat unavailable)

### Failure Alerts

Configure email notifications for flow failures:

1. Open the flow in edit mode
2. Click **...** (more options) > **Settings**
3. Under **Run after settings**, ensure failure notifications are enabled
4. Alternatively, use the Power Automate Management connector to build a monitoring flow:
   - Trigger: Scheduled (every hour)
   - Action: List flow runs filtered by status = "Failed" and start time > 1 hour ago
   - Condition: If any failed runs, send alert email to admin

### Retry Policies

Configure retry policies on all ClearMind connector actions:

```
Retry Policy: Exponential
Count: 3
Interval: PT30S (30 seconds)
Minimum Interval: PT10S
Maximum Interval: PT5M
```

**Configuration Steps**:
1. Click on the ClearMind connector action in the flow
2. Click **...** > **Settings**
3. Under **Networking**, configure the Retry Policy
4. Set the values above
5. Save the flow

---

## Application Insights Integration

### Setup

1. Create an Application Insights resource in Azure Portal
2. Add the instrumentation key to the Express API environment variables:
   ```
   APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=your-key;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/
   ```
3. The Express API automatically sends telemetry when the connection string is configured

### Custom Telemetry

The ClearMind API sends the following custom telemetry:

**Custom Events**:
- `JournalEntryCreated`: Fired when a new entry is created (properties: entryId, hasTitle, tagCount)
- `JournalEntryAnalyzed`: Fired when analysis completes (properties: entryId, mood, sentimentScore, duration)
- `SearchPerformed`: Fired on each search (properties: queryLength, resultCount, duration)
- `CoachingSessionStarted`: Fired when a coaching conversation begins (properties: conversationId, includeContext)
- `RecapGenerated`: Fired when a recap is generated (properties: period, entryCount, duration)
- `CrisisDetected`: Fired when crisis language is detected (properties: escalated -- no content logged)

**Custom Metrics**:
- `api.request.duration`: Request duration in milliseconds (dimensions: endpoint, method, statusCode)
- `groq.inference.duration`: Time spent waiting for Groq LLM response (dimensions: model, endpoint)
- `groq.tokens.used`: Token count for LLM calls (dimensions: model, promptTokens, completionTokens)
- `db.query.duration`: Database query execution time (dimensions: operation, table)

### API Latency Tracking

**Setting Up Latency Dashboards**:

1. In Application Insights, go to **Metrics**
2. Create charts for the following:
   - `api.request.duration` grouped by `endpoint` (line chart, avg and p95)
   - `groq.inference.duration` grouped by `endpoint` (line chart, avg and p95)
   - `db.query.duration` grouped by `operation` (line chart, avg and p95)
3. Pin these charts to an Azure Dashboard for at-a-glance monitoring

**Latency Targets**:

| Endpoint | p50 Target | p95 Target | p99 Target |
|----------|-----------|-----------|-----------|
| GET /api/entries | < 100ms | < 300ms | < 500ms |
| POST /api/entries | < 150ms | < 400ms | < 700ms |
| POST /api/entries/{id}/analyze | < 2s | < 4s | < 6s |
| GET /api/search | < 1s | < 3s | < 5s |
| POST /api/coach | < 2s | < 5s | < 8s |
| GET /api/recap | < 3s | < 6s | < 10s |

### Error Rate Dashboards

1. In Application Insights, go to **Failures**
2. Review:
   - **Failed requests**: HTTP 4xx and 5xx responses grouped by endpoint
   - **Exceptions**: Unhandled exceptions with stack traces
   - **Dependencies**: Failed calls to Groq API, PostgreSQL, Microsoft Graph
3. Create a custom workbook:
   - Error rate over time (percentage of 5xx responses)
   - Top 5 failing endpoints
   - Dependency failure rate by service
   - Error rate by authentication method (web vs. connector vs. Power Automate)

### Log Analytics Queries

Useful KQL queries for monitoring:

**API Error Rate (last 24 hours)**:
```kql
requests
| where timestamp > ago(24h)
| summarize totalRequests = count(), failedRequests = countif(resultCode >= 500) by bin(timestamp, 1h)
| extend errorRate = round(100.0 * failedRequests / totalRequests, 2)
| project timestamp, totalRequests, failedRequests, errorRate
| order by timestamp desc
```

**Slow API Requests (> 3 seconds)**:
```kql
requests
| where timestamp > ago(24h)
| where duration > 3000
| project timestamp, name, duration, resultCode, customDimensions
| order by duration desc
| take 50
```

**Groq LLM Latency Distribution**:
```kql
customMetrics
| where name == "groq.inference.duration"
| where timestamp > ago(7d)
| summarize p50 = percentile(value, 50), p95 = percentile(value, 95), p99 = percentile(value, 99) by bin(timestamp, 1h)
| render timechart
```

**Crisis Detection Events**:
```kql
customEvents
| where name == "CrisisDetected"
| where timestamp > ago(30d)
| summarize count() by bin(timestamp, 1d)
| render barchart
```

---

## Key Performance Indicators

### KPI Summary Table

| KPI | Target | Warning Threshold | Critical Threshold | Measurement Source |
|-----|--------|-------------------|--------------------|--------------------|
| API Response Time (p95) | < 3s | > 3s | > 5s | Application Insights |
| Topic Resolution Rate | > 80% | < 80% | < 60% | Copilot Studio Analytics |
| Escalation Rate | < 5% | > 5% | > 10% | Copilot Studio Analytics |
| Flow Success Rate | > 95% | < 95% | < 90% | Power Automate Run History |
| API Error Rate (5xx) | < 1% | > 1% | > 5% | Application Insights |
| API Availability | > 99.5% | < 99.5% | < 99% | Application Insights |
| Groq LLM Latency (p95) | < 4s | > 4s | > 8s | Application Insights |
| Database Query Time (p95) | < 200ms | > 200ms | > 500ms | Application Insights |
| Daily Active Users | Trending up | Week-over-week decline | 50% drop | Copilot Studio Analytics |
| CSAT Score | >= 4.0 | < 4.0 | < 3.0 | Copilot Studio Surveys |

### KPI Review Schedule

| Cadence | KPIs Reviewed | Audience |
|---------|--------------|----------|
| Daily | API Error Rate, Flow Success Rate, Crisis Detection Events | Operations team |
| Weekly | All KPIs | Product and operations team |
| Monthly | All KPIs + trend analysis, user adoption metrics | Leadership and stakeholders |

---

## Alert Configuration

### Application Insights Alerts

Configure the following alerts in Azure Portal > Application Insights > Alerts:

**Alert 1: High API Error Rate**
- Condition: Percentage of failed requests (5xx) > 5% over 5-minute window
- Severity: Critical (Sev 1)
- Action: Email operations team, create incident in service management tool
- Evaluation frequency: Every 1 minute
- Lookback period: 5 minutes

**Alert 2: API Latency Degradation**
- Condition: Average request duration > 5 seconds over 10-minute window
- Severity: Warning (Sev 2)
- Action: Email operations team
- Evaluation frequency: Every 5 minutes
- Lookback period: 10 minutes

**Alert 3: Groq LLM Dependency Failure**
- Condition: Dependency failure rate for Groq API > 10% over 5-minute window
- Severity: Critical (Sev 1)
- Action: Email operations team, trigger fallback notification to users
- Evaluation frequency: Every 1 minute
- Lookback period: 5 minutes

**Alert 4: Database Connection Failure**
- Condition: Dependency failure rate for PostgreSQL > 0% over 1-minute window
- Severity: Critical (Sev 0)
- Action: Email operations team, page on-call engineer
- Evaluation frequency: Every 1 minute
- Lookback period: 1 minute

**Alert 5: Unusual Usage Spike**
- Condition: Request count > 200% of same-hour average over past 7 days
- Severity: Informational (Sev 3)
- Action: Email operations team for review
- Evaluation frequency: Every 15 minutes
- Lookback period: 1 hour

### Power Automate Alert Flow

Create a dedicated monitoring flow:

1. **Name**: `ClearMind - Flow Health Monitor`
2. **Trigger**: Recurrence (every 1 hour)
3. **Actions**:
   - List runs for each ClearMind flow filtered by status = "Failed" and start time > 1 hour ago
   - If any failures detected:
     - Compose alert message with flow name, run ID, failure time, and error summary
     - Send email to admin distribution list
     - Post to a dedicated Teams "Operations Alerts" channel
   - Log the check result to Dataverse for audit trail

### Copilot Studio Alerts

Copilot Studio does not natively support real-time alerts. Implement monitoring via:

1. **Weekly Analytics Export**: Manually review Copilot Studio analytics dashboard every Monday
2. **Custom Telemetry**: The Express API logs all requests from the Copilot Studio connector; use Application Insights alerts on these requests
3. **Escalation Monitoring**: Track crisis escalation events via the `CrisisDetected` custom event in Application Insights; alert immediately on any occurrence

### Alert Escalation Matrix

| Severity | Response Time | First Responder | Escalation |
|----------|--------------|-----------------|------------|
| Sev 0 (Critical - Data) | 15 minutes | On-call engineer | Engineering manager within 30 minutes |
| Sev 1 (Critical - Service) | 30 minutes | On-call engineer | Engineering manager within 1 hour |
| Sev 2 (Warning) | 2 hours | Operations team | Engineering team within 4 hours |
| Sev 3 (Informational) | Next business day | Operations team | Review in weekly meeting |
