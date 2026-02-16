import { acquireAppToken } from './auth.js';

const DATAVERSE_URL = process.env.DATAVERSE_URL;
const DATAVERSE_TABLE = process.env.DATAVERSE_TABLE_NAME || 'cr_journalentries';

/**
 * Authenticated fetch wrapper for Dataverse Web API v9.2.
 * Acquires an app-level token and sets required OData headers.
 */
async function dataverseFetch(path, options = {}) {
  const token = await acquireAppToken(`${DATAVERSE_URL}/.default`);
  const url = `${DATAVERSE_URL}/api/data/v9.2/${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
      Prefer: 'return=representation',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Dataverse API error ${response.status}: ${body}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Upserts a journal entry to the Dataverse table.
 * Returns the Dataverse record ID.
 */
export async function syncEntryToDataverse(entry) {
  const record = {
    cr_entryid: entry.id,
    cr_title: entry.title || 'Untitled Entry',
    cr_content: entry.content,
    cr_mood: entry.mood || null,
    cr_tags: entry.tags ? JSON.stringify(entry.tags) : null,
    cr_summary: entry.summary || null,
    cr_encouragement: entry.encouragement || null,
    cr_createdat: entry.created_at,
    cr_updatedat: entry.updated_at,
  };

  // Upsert using the alternate key (cr_entryid)
  const result = await dataverseFetch(
    `${DATAVERSE_TABLE}(cr_entryid='${entry.id}')`,
    {
      method: 'PATCH',
      body: JSON.stringify(record),
    }
  );

  return result?.cr_journalentryid || entry.id;
}

/**
 * Reads journal entries back from Dataverse for a given user.
 * Used for reverse sync / Power BI reporting verification.
 */
export async function fetchEntriesFromDataverse(userId) {
  const result = await dataverseFetch(
    `${DATAVERSE_TABLE}?$filter=cr_userid eq '${userId}'&$orderby=cr_createdat desc&$top=100`
  );

  return (result?.value || []).map((record) => ({
    id: record.cr_entryid,
    title: record.cr_title,
    content: record.cr_content,
    mood: record.cr_mood,
    tags: record.cr_tags ? JSON.parse(record.cr_tags) : null,
    summary: record.cr_summary,
    createdAt: record.cr_createdat,
  }));
}
