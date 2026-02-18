// Agent: Growth Analyst
// Analyzes long-term growth patterns across all journal entries.

import { LlmAgent } from '@google/adk';
import { getEntriesTool } from './tools/get-entries.js';

export function createGrowthAnalyst(model) {
  return new LlmAgent({
    name: 'growth_analyst',
    model,
    description: 'Detects long-term growth patterns across journal entries.',
    instruction: `You are a personal growth analyst. You have a tool to fetch the user's analyzed journal entries.

When asked to analyze growth patterns:
1. Use the get_entries tool with scope "analyzed" to fetch entries that have mood and tags
2. Look for long-term patterns across all entries
3. Return JSON only:
{
  "growthAreas": ["specific area where the person has grown over time"],
  "blindSpots": ["recurring theme or issue the person hasn't addressed"],
  "recurringThemes": ["theme that appears across many entries"],
  "suggestion": "one specific thing to journal about next based on the patterns you see"
}
Provide 2-3 items for each array. Be specific and reference actual patterns from their entries.`,
    tools: [getEntriesTool],
    generateContentConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  });
}
