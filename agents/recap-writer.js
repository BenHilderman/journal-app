// Agent: Recap Writer
// Generates weekly summary recaps from recent journal entries.

import { LlmAgent } from '@google/adk';
import { getEntriesTool } from './tools/get-entries.js';

export function createRecapWriter(model) {
  return new LlmAgent({
    name: 'recap_writer',
    model,
    description: 'Generates weekly summary recaps from journal entries.',
    instruction: `You are a personal growth coach. You have a tool to fetch the user's recent journal entries.

When asked to generate a recap:
1. Use the get_entries tool with scope "week" to fetch this week's entries
2. Summarize the week based on those entries
3. Return JSON only:
{
  "summary": "3-4 sentence overview of their week",
  "highlights": ["highlight 1", "highlight 2", "highlight 3"],
  "mood": "overall mood for the week",
  "focusAreas": ["what they focused on most"],
  "suggestion": "one thing to focus on next week"
}`,
    tools: [getEntriesTool],
    generateContentConfig: {
      temperature: 0.5,
      maxOutputTokens: 1024,
    },
  });
}
