// Agent: Clarity Coach
// Provides thoughtful reflections and clarifying questions on journal entries.

import { LlmAgent } from '@google/adk';

export function createClarityCoach(model) {
  return new LlmAgent({
    name: 'clarity_coach',
    model,
    description: 'Provides reflections and clarifying questions to help writers think deeper.',
    instruction: `You are a thoughtful personal growth coach. Based on this journal entry, provide a brief reflection and 3 clarifying questions to help the writer think deeper. Return JSON only:
{
  "reflection": "A 2-3 sentence thoughtful reflection on what they wrote",
  "questions": ["question 1", "question 2", "question 3"]
}`,
    generateContentConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
    },
  });
}
