// ADK Agent Runner — central orchestration for all ClearMindAI agents.
// Creates agents, manages sessions, and provides runAgent/streamAgent helpers.

import { InMemoryRunner, InMemorySessionService, isFinalResponse } from '@google/adk';
import { createUserContent } from '@google/genai';
import { getModel, DEFAULT_PROVIDER } from './models.js';
import { createMoodAnalyst } from './mood-analyst.js';
import { createClarityCoach } from './clarity-coach.js';
import { createReflector } from './reflector.js';
import { createRecapWriter } from './recap-writer.js';
import { createGrowthAnalyst } from './growth-analyst.js';
import { createCoach } from './coach.js';
import { safeParseJson } from '../utils.js';

const APP_NAME = 'clearmind';

// Agent factory — creates agents with the specified model
function createAgents(model) {
  return {
    mood_analyst: createMoodAnalyst(model),
    clarity_coach: createClarityCoach(model),
    reflector: createReflector(model),
    recap_writer: createRecapWriter(model),
    growth_analyst: createGrowthAnalyst(model),
    coach: createCoach(model),
  };
}

// Session service (shared across all runners)
const sessionService = new InMemorySessionService();

// Cache runners per-model-config to avoid recreating them
const runnerCache = new Map();

function getRunner(agentName, model) {
  const agents = createAgents(model);
  const agent = agents[agentName];
  if (!agent) throw new Error(`Unknown agent: ${agentName}`);

  const cacheKey = `${agentName}:${typeof model === 'string' ? model : model.model}`;
  if (!runnerCache.has(cacheKey)) {
    runnerCache.set(cacheKey, new InMemoryRunner({
      agent,
      appName: APP_NAME,
    }));
  }
  return runnerCache.get(cacheKey);
}

/**
 * Runs an ADK agent and returns the final text response.
 *
 * @param {string} agentName - name of the agent (e.g. 'mood_analyst')
 * @param {string} userMessage - the user's input text
 * @param {object} options - { userId, apiKey, provider }
 * @returns {Promise<string>} the agent's text response
 */
export async function runAgent(agentName, userMessage, { userId, apiKey, provider } = {}) {
  const resolvedProvider = provider || DEFAULT_PROVIDER;
  const model = getModel(resolvedProvider, apiKey);
  const runner = getRunner(agentName, model);

  const sessionId = `${userId || 'anon'}-${agentName}-${Date.now()}`;
  const session = await runner.sessionService.createSession({
    appName: APP_NAME,
    userId: userId || 'anon',
    sessionId,
    state: { userId },
  });

  let finalText = '';

  for await (const event of runner.runAsync({
    userId: userId || 'anon',
    sessionId: session.id,
    newMessage: createUserContent(userMessage),
  })) {
    if (isFinalResponse(event) && event.content?.parts) {
      finalText = event.content.parts
        .map(p => p.text || '')
        .join('');
    }
  }

  // Clean up session
  await runner.sessionService.deleteSession({
    appName: APP_NAME,
    userId: userId || 'anon',
    sessionId: session.id,
  });

  return finalText;
}

/**
 * Runs an ADK agent and yields tokens for streaming (SSE).
 *
 * @param {string} agentName - name of the agent
 * @param {string} userMessage - the user's input text
 * @param {object} options - { userId, apiKey, provider }
 * @yields {string} individual tokens
 */
export async function* streamAgent(agentName, userMessage, { userId, apiKey, provider } = {}) {
  const resolvedProvider = provider || DEFAULT_PROVIDER;
  const model = getModel(resolvedProvider, apiKey);
  const runner = getRunner(agentName, model);

  const sessionId = `${userId || 'anon'}-${agentName}-${Date.now()}`;
  const session = await runner.sessionService.createSession({
    appName: APP_NAME,
    userId: userId || 'anon',
    sessionId,
    state: { userId },
  });

  for await (const event of runner.runAsync({
    userId: userId || 'anon',
    sessionId: session.id,
    newMessage: createUserContent(userMessage),
  })) {
    // Yield text from partial and final events
    if (event.content?.parts) {
      for (const part of event.content.parts) {
        if (part.text) {
          yield part.text;
        }
      }
    }
  }

  await runner.sessionService.deleteSession({
    appName: APP_NAME,
    userId: userId || 'anon',
    sessionId: session.id,
  });
}

/**
 * Returns status info about available agents and current provider.
 */
export function getAgentStatus(provider) {
  return {
    provider: provider || DEFAULT_PROVIDER,
    agents: [
      { name: 'mood_analyst', label: 'Mood Analyst', description: 'Detects mood, tags, summary' },
      { name: 'clarity_coach', label: 'Clarity Coach', description: 'Reflection + questions' },
      { name: 'reflector', label: 'Reflector', description: 'RAG-powered pattern detection' },
      { name: 'recap_writer', label: 'Recap Writer', description: 'Weekly recap generation' },
      { name: 'growth_analyst', label: 'Growth Analyst', description: 'Long-term growth analysis' },
      { name: 'coach', label: 'Coach', description: 'Interactive coaching' },
    ],
    framework: 'Google ADK',
    version: '0.3.0',
  };
}

/**
 * Maps endpoint names to agent names for attribution.
 */
export const AGENT_LABELS = {
  analyze: 'Mood Analyst',
  clarity: 'Clarity Coach',
  reflect: 'Reflector',
  recap: 'Recap Writer',
  'growth-patterns': 'Growth Analyst',
  coach: 'Coach',
};
