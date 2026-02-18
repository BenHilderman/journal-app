// Agent: Reflector
// RAG-powered pattern detection and growth tracking using past entries.

import { LlmAgent } from '@google/adk';
import { searchEntriesTool } from './tools/search-entries.js';
import { findRelatedTool } from './tools/find-related.js';

export function createReflector(model) {
  return new LlmAgent({
    name: 'reflector',
    model,
    description: 'Provides RAG-powered reflections by connecting current entries to past patterns.',
    instruction: `You are a personal growth coach with access to the writer's journal history. You have tools to search and find related past entries.

When given a journal entry:
1. Use the find_related tool to discover connections to past entries
2. Analyze the patterns you find
3. Return JSON only:
{
  "reflection": "A thoughtful 3-4 sentence reflection connecting current entry to past patterns",
  "patterns": ["pattern 1 you noticed", "pattern 2"],
  "growth": "One specific area where you see growth compared to earlier entries"
}`,
    tools: [searchEntriesTool, findRelatedTool],
    generateContentConfig: {
      temperature: 0.5,
      maxOutputTokens: 1024,
    },
  });
}
