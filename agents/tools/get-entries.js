// ADK Tool: get-entries
// Fetches recent journal entries with metadata for context building.

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import {
  getEntries as dbGetEntries,
  getEntriesInDateRange,
  getAnalyzedEntries,
} from '../../db.js';

const getEntriesSchema = z.object({
  scope: z.enum(['recent', 'week', 'analyzed']).describe(
    'Which entries to fetch: "recent" for latest entries, "week" for last 7 days, "analyzed" for entries with mood/tags'
  ),
  limit: z.number().optional().describe('Maximum number of entries to return (default 10)'),
});

export const getEntriesTool = new FunctionTool({
  name: 'get_entries',
  description: 'Fetches journal entries from the user\'s history. Can retrieve recent entries, entries from the past week, or only analyzed entries with mood and tags.',
  parameters: getEntriesSchema,
  execute: async ({ scope, limit }, toolContext) => {
    const userId = toolContext?.state?.get('userId');
    if (!userId) return { error: 'No user context available' };

    const maxResults = limit || 10;
    let entries;

    if (scope === 'week') {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      entries = await getEntriesInDateRange(userId, oneWeekAgo, new Date());
    } else if (scope === 'analyzed') {
      entries = await getAnalyzedEntries(userId);
    } else {
      entries = await dbGetEntries(userId);
    }

    const results = entries.slice(0, maxResults).map(e => ({
      date: new Date(e.created_at).toLocaleDateString(),
      title: e.title || 'Untitled',
      mood: e.mood || 'unknown',
      tags: e.tags || [],
      summary: e.summary || e.content.substring(0, 200),
      content: e.content.substring(0, 300),
    }));

    return { entries: results, count: results.length, total: entries.length };
  },
});
