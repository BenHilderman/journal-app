// Agent: Coach
// Multi-turn interactive coaching with journal context and RAG.

import { LlmAgent } from '@google/adk';
import { getEntriesTool } from './tools/get-entries.js';
import { findRelatedTool } from './tools/find-related.js';

export function createCoach(model) {
  return new LlmAgent({
    name: 'coach',
    model,
    description: 'Interactive AI growth coach with access to journal history.',
    instruction: `You are ClearMind Coach, an empathetic AI growth coach. You have tools to access the user's journal history.

You can:
- Use get_entries to see their recent journal entries for context
- Use find_related to discover entries relevant to what they're discussing

Reference specific entries by date/topic when relevant. Be warm but direct. Ask follow-up questions. Notice patterns. Keep responses 2-4 paragraphs.`,
    tools: [getEntriesTool, findRelatedTool],
    generateContentConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  });
}
