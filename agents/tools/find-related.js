// ADK Tool: find-related
// Finds semantically related past entries using trigram embeddings.
// Used by the Reflector and Coach agents for RAG-powered context.

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { getEntriesWithEmbeddings } from '../../db.js';
import { getEmbedding, cosineSimilarity } from '../../utils.js';

const findRelatedSchema = z.object({
  text: z.string().describe('The text to find related entries for'),
  limit: z.number().optional().describe('Maximum number of related entries (default 5)'),
});

export const findRelatedTool = new FunctionTool({
  name: 'find_related',
  description: 'Finds journal entries that are semantically related to the given text. Uses embedding similarity to discover connections between current thoughts and past entries.',
  parameters: findRelatedSchema,
  execute: async ({ text, limit }, toolContext) => {
    const userId = toolContext?.state?.get('userId');
    if (!userId) return { error: 'No user context available' };

    const entries = await getEntriesWithEmbeddings(userId);
    const queryEmbedding = getEmbedding(text);
    const maxResults = limit || 5;

    const related = entries
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

    return { related, count: related.length };
  },
});
