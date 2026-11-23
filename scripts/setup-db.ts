import nextEnv from '@next/env';
import { db } from '../src/lib/db';
nextEnv.loadEnvConfig(process.cwd());
const sql = db();
await sql.transaction([
  sql`CREATE TABLE IF NOT EXISTS mcp_subscriptions (
    scope text NOT NULL, key text NOT NULL, record jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope, key))`,
  sql`CREATE INDEX IF NOT EXISTS mcp_subscriptions_id ON mcp_subscriptions(scope, (record->>'id'))`,
  sql`CREATE TABLE IF NOT EXISTS received_events (
    event_id text PRIMARY KEY, name text NOT NULL, data jsonb NOT NULL,
    event_timestamp timestamptz NOT NULL, cursor text,
    received_at timestamptz NOT NULL DEFAULT now(), summary text,
    summary_status text NOT NULL DEFAULT 'pending')`,
  sql`CREATE INDEX IF NOT EXISTS received_events_recent ON received_events(received_at DESC)`,
  sql`CREATE TABLE IF NOT EXISTS subscription_control (
    scope text PRIMARY KEY, owner uuid NOT NULL, locked_until timestamptz NOT NULL)`,
]);
console.log('Receiver schema ready (idempotent).');
