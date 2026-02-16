import { Client } from '@microsoft/microsoft-graph-client';
import { acquireAppToken } from './auth.js';

/**
 * Creates an authenticated Microsoft Graph client using app-level credentials.
 */
async function getGraphClient() {
  const token = await acquireAppToken('https://graph.microsoft.com/.default');
  return Client.init({
    authProvider: (done) => done(null, token),
  });
}

/**
 * Fetches today's calendar events for a user by their Azure AD OID.
 * Uses the /calendarView endpoint with today's date range.
 */
export async function getUserCalendarEvents(userOid) {
  const client = await getGraphClient();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const response = await client
    .api(`/users/${userOid}/calendarView`)
    .query({
      startDateTime: startOfDay.toISOString(),
      endDateTime: endOfDay.toISOString(),
    })
    .select('subject,start,end,isAllDay,location')
    .orderby('start/dateTime')
    .top(20)
    .get();

  return (response.value || []).map((event) => ({
    subject: event.subject,
    start: event.start?.dateTime,
    end: event.end?.dateTime,
    isAllDay: event.isAllDay,
    location: event.location?.displayName || null,
  }));
}

/**
 * Fetches the Teams presence/availability status for a user.
 */
export async function getUserPresence(userOid) {
  const client = await getGraphClient();
  const presence = await client.api(`/users/${userOid}/presence`).get();

  return {
    availability: presence.availability, // e.g. "Available", "Busy", "Away"
    activity: presence.activity, // e.g. "InACall", "InAMeeting", "Presenting"
  };
}

/**
 * Formats calendar events and presence into a context string
 * suitable for including in AI prompts.
 */
export function formatCalendarContext(events, presence) {
  const parts = [];

  if (presence) {
    parts.push(`Current status: ${presence.availability} (${presence.activity || 'idle'}).`);
  }

  if (events.length === 0) {
    parts.push('No meetings scheduled for today.');
  } else {
    parts.push(`${events.length} meeting${events.length === 1 ? '' : 's'} today:`);
    for (const event of events) {
      const start = new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const end = new Date(event.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const loc = event.location ? ` at ${event.location}` : '';
      parts.push(`  - ${event.subject} (${start}–${end}${loc})`);
    }
  }

  return parts.join('\n');
}
