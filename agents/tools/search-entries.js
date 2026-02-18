// ADK Tool: search-entries
// Searches user's journal entries by semantic similarity using trigram embeddings.

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { getEntriesWithEmbeddings } from '../../db.js';
import { getEmbedding, cosineSimilarity } from '../../utils.js';

const searchEntriesSchema = z.object({
  query: z.string().describe('The search query to find semantically similar entries'),
  limit: z.number().optional().describe('Maximum number of results to return (default 5)'),
});

export const searchEntriesTool = new FunctionTool({
  name: 'search_entries',
  description: 'Searches the user\'s journal entries by meaning using semantic similarity. Returns the most relevant entries with their content, mood, tags, and similarity scores.',
  parameters: searchEntriesSchema,
  execute: async ({ query, limit }, toolContext) => {
    const userId = toolContext?.state?.get('userId');
    if (!userId) return { error: 'No user context available' };

    const entries = await getEntriesWithEmbeddings(userId);
    const queryEmbedding = getEmbedding(query);
    const maxResults = limit || 5;

    const results = entries
      .map(entry => ({
        date: new Date(entry.created_at).toLocaleDateString(),
        mood: entry.mood || 'unknown',
        tags: entry.tags || [],
        content: entry.content.substring(0, 300),
        similarity: cosineSimilarity(queryEmbedding, entry.embedding),
      }))
      .filter(r => r.similarity > 0.15)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxResults);

    return { results, count: results.length };
  },
});
