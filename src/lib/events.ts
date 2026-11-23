import type { Experimental_MCPEvent } from '@ai-sdk/mcp';
import { db, serverUrl } from './db';

export async function persistEvent(event: Experimental_MCPEvent) {
  const rows = await db()`INSERT INTO received_events(event_id, name, data, event_timestamp, cursor)
    VALUES (${event.eventId}, ${event.name}, ${JSON.stringify(event.data)}::jsonb, ${event.timestamp}, ${event.cursor ?? null})
    ON CONFLICT(event_id) DO NOTHING RETURNING event_id`;
  return rows.length > 0;
}

export async function readFeed() {
  const sql = db();
  const [events, subscriptions, [count]] = await Promise.all([
    sql`SELECT event_id AS "eventId", name, data, event_timestamp AS timestamp, cursor,
      received_at AS "receivedAt", summary, summary_status AS "summaryStatus"
      FROM received_events ORDER BY received_at DESC, event_id DESC LIMIT 50`,
    sql`SELECT record->>'id' AS id, record->>'name' AS name, record->>'status' AS status,
      record->>'refreshBefore' AS "refreshBefore" FROM mcp_subscriptions WHERE scope = ${serverUrl()} ORDER BY record->>'name'`,
    sql`SELECT count(*)::int AS total FROM received_events`,
  ]);
  return { events, subscriptions, total: count.total as number, asOf: Date.now() };
}
