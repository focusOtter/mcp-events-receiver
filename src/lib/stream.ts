import { Client, neonConfig } from '@neondatabase/serverless';
import WebSocket from 'ws';
import { db, serverUrl } from './db';
import { readFeed } from './events';
import type { Feed, ReceivedEvent } from './feed-types';

export type FeedMessage =
  | { kind: 'snapshot'; feed: Feed }
  | { kind: 'event'; event: ReceivedEvent; total: number; asOf: number }
  | { kind: 'subscriptions'; subscriptions: Feed['subscriptions']; asOf: number };

export function resumeCursor(request: Request) {
  const value = request.headers.get('last-event-id') ?? new URL(request.url).searchParams.get('after') ?? '0';
  if (!/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > BigInt('9223372036854775807')) {
    throw new Error('Invalid stream cursor');
  }
  return value;
}

export function formatMessage(message: FeedMessage, cursor?: string) {
  return `${cursor === undefined ? '' : `id: ${cursor}\n`}data: ${JSON.stringify(message)}\n\n`;
}

export function listenerClient() {
  const value = process.env.DATABASE_URL_UNPOOLED;
  if (!value || new URL(value).hostname.includes('-pooler.')) throw new Error('DATABASE_URL_UNPOOLED must be a direct Neon URL');
  neonConfig.webSocketConstructor = WebSocket;
  return new Client({ connectionString: value, connectionTimeoutMillis: 10000 });
}

export async function readChanges(after: string, sql = db()) {
  return sql`SELECT cursor::text, kind, entity_id FROM receiver_feed_changes
    WHERE cursor > ${after}::bigint AND (scope = '' OR scope = ${serverUrl()}) ORDER BY cursor LIMIT 100`;
}

export async function loadChange(kind: string, id: string, sql = db()): Promise<FeedMessage | undefined> {
  if (kind === 'subscriptions') {
    const subscriptions = await sql`SELECT record->>'id' AS id, record->>'name' AS name, record->>'status' AS status,
      record->>'refreshBefore' AS "refreshBefore" FROM mcp_subscriptions WHERE scope = ${serverUrl()} ORDER BY record->>'name'`;
    return { kind, subscriptions: subscriptions as Feed['subscriptions'], asOf: Date.now() };
  }
  const [event] = await sql`SELECT event_id AS "eventId", name, data, event_timestamp AS timestamp, cursor,
    received_at AS "receivedAt", summary, summary_status AS "summaryStatus" FROM received_events WHERE event_id = ${id}`;
  if (!event) return;
  const [count] = await sql`SELECT count(*)::int AS total FROM received_events`;
  return { kind: 'event', event: event as ReceivedEvent, total: count.total, asOf: Date.now() };
}

export function openFeedStream(request: Request, after: string, client = listenerClient(), lifetime = 55000) {
  const encoder = new TextEncoder();
  let finish: () => void = () => {};
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let ready = false;
      let running = false;
      let dirty = false;
      let cursor = after;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const send = (value: string) => { if (!closed) controller.enqueue(encoder.encode(value)); };
      finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(deadline);
        request.signal.removeEventListener('abort', finish);
        if (!cancelled) controller.close();
        void client.end().catch(() => {});
      };
      const drain = async () => {
        dirty = true;
        if (!ready || running || closed) return;
        running = true;
        try {
          while (dirty && !closed) {
            dirty = false;
            const changes = await readChanges(cursor);
            for (const change of changes) {
              if (closed) break;
              const message = await loadChange(change.kind, change.entity_id);
              if (message) send(formatMessage(message, change.cursor));
              cursor = change.cursor;
            }
            if (changes.length === 100) dirty = true;
          }
        } catch { finish(); }
        finally { running = false; }
      };
      client.on('notification', () => { void drain(); });
      client.on('error', finish);
      client.on('end', finish);
      request.signal.addEventListener('abort', finish, { once: true });
      const deadline = setTimeout(finish, lifetime);
      if (request.signal.aborted) { finish(); return; }
      void (async () => {
        try {
          await client.connect();
          if (closed) return;
          await client.query('LISTEN receiver_feed');
          if (closed) return;
          send('retry: 1000\n\n');
          send(formatMessage({ kind: 'snapshot', feed: await readFeed() as Feed }));
          if (closed) return;
          heartbeat = setInterval(() => send(': ping\n\n'), 25000);
          ready = true;
          await drain();
        } catch { finish(); }
      })();
    },
    cancel() { cancelled = true; finish(); },
  });
}
