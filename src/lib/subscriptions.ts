import { randomUUID } from 'node:crypto';
import { createMCPClient } from '@ai-sdk/mcp';
import { db, serverUrl } from './db';
import { eventStore } from './store';

export function publicBaseUrl() {
  const base = process.env.APP_BASE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://127.0.0.1:3001');
  const url = new URL(base);
  if ((url.protocol !== 'https:' && !(process.env.NODE_ENV === 'development' && url.origin === 'http://127.0.0.1:3001')) || url.username || url.password || url.hash || url.search || url.pathname !== '/') throw new Error('Invalid public base URL');
  return url.origin;
}

export async function manageSubscriptions(mode: 'subscribe' | 'unsubscribe') {
  const scope = serverUrl();
  const sql = db();
  const owner = randomUUID();
  const lock = await sql`INSERT INTO subscription_control(scope, owner, locked_until) VALUES (${scope}, ${owner}, now() + interval '90 seconds')
    ON CONFLICT(scope) DO UPDATE SET owner = EXCLUDED.owner, locked_until = EXCLUDED.locked_until
    WHERE subscription_control.locked_until < now() RETURNING owner`;
  if (!lock.length) throw new Error('Another subscription change is in progress. Please try again shortly.');
  try {
    const store = eventStore();
    const client = await createMCPClient({ transport: { type: 'http', url: scope }, experimental_events: { store } });
    try {
      const existing = await sql`SELECT key, record->>'name' AS name, record->>'id' AS id, record->'delivery'->>'url' AS url FROM mcp_subscriptions WHERE scope = ${scope}`;
      if (mode === 'unsubscribe') {
        for (const row of existing) await client.experimental_events.unsubscribe({ key: row.key as string });
        return;
      }
      const catalog = await client.experimental_events.list();
      const callback = `${publicBaseUrl()}/api/mcp-events`;
      for (const name of ['appointment.booked', 'appointment.cancelled']) {
        if (!catalog.events.some(event => event.name === name)) throw new Error('Required event is not advertised by the server.');
        const current = existing.find(row => row.name === name && new URL(row.url as string).origin === publicBaseUrl());
        if (current) await client.experimental_events.refresh({ key: current.key as string });
        else await client.experimental_events.subscribe({ name, ttlMs: 86400000, delivery: { mode: 'webhook', url: callback, allowInsecureLocalhost: process.env.NODE_ENV === 'development' } });
      }
    } finally { await client.close(); }
  } finally {
    await sql`DELETE FROM subscription_control WHERE scope = ${scope} AND owner = ${owner}`;
  }
}
