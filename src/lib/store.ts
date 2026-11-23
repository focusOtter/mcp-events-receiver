import type { Experimental_MCPEventStore, Experimental_MCPEventSubscription } from '@ai-sdk/mcp';
import { db, serverUrl } from './db';

export function createPostgresStore(scope: string, sql = db()): Experimental_MCPEventStore {
  return {
    async get(key) {
      const [row] = await sql`SELECT record FROM mcp_subscriptions WHERE scope = ${scope} AND key = ${key}`;
      return row?.record as Experimental_MCPEventSubscription | undefined;
    },
    async getById(id) {
      const [row] = await sql`SELECT record FROM mcp_subscriptions WHERE scope = ${scope} AND record->>'id' = ${id}`;
      return row?.record as Experimental_MCPEventSubscription | undefined;
    },
    async set(subscription) {
      await sql`INSERT INTO mcp_subscriptions(scope, key, record) VALUES (${scope}, ${subscription.key}, ${JSON.stringify(subscription)}::jsonb)
        ON CONFLICT(scope, key) DO UPDATE SET record = EXCLUDED.record, updated_at = now()`;
    },
    async update(key, patch) {
      const rows = await sql`UPDATE mcp_subscriptions SET record = record || ${JSON.stringify(patch)}::jsonb, updated_at = now()
        WHERE scope = ${scope} AND key = ${key} RETURNING key`;
      if (!rows.length) throw new Error('Unknown subscription');
    },
    async delete(key) {
      await sql`DELETE FROM mcp_subscriptions WHERE scope = ${scope} AND key = ${key}`;
    },
  };
}

export function eventStore() { return createPostgresStore(serverUrl()); }
