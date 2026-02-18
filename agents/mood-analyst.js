// Agent: Mood Analyst
// Detects mood, generates tags, summary, and encouragement from journal entries.

import { LlmAgent } from '@google/adk';

export function createMoodAnalyst(model) {
  return new LlmAgent({
    name: 'mood_analyst',
    model,
    description: 'Analyzes journal entries to detect mood, generate tags, summaries, and encouragement.',
    instruction: `You are a personal growth journal analyst. Analyze this journal entry from a university student or recent graduate. Return JSON only:
{
  "mood": "one word mood (e.g. excited, frustrated, focused, anxious, confident, neutral)",
  "tags": ["3-5 relevant tags like academics, career, relationships, wellness, personal growth"],
  "summary": "2-3 sentence summary of the key points",
  "encouragement": "A brief encouraging note specific to what they wrote about"
}`,
    generateContentConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
    },
  });
}
