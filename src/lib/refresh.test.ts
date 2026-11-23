import { createHmac } from 'node:crypto';
import { createMCPClient, experimental_createMCPEventWebhook, type Experimental_MCPEventSubscription } from '@ai-sdk/mcp';
import { expect, it, vi } from 'vitest';
import type { db } from './db';
import { createPostgresStore } from './store';

it.each([
  { pending: false, cursor: false },
  { pending: true, cursor: false },
  { pending: true, cursor: true },
])('SDK refresh delivery and cursor guards: %j', async guards => {
  const bytes = Buffer.alloc(32, 7);
  let record: Experimental_MCPEventSubscription = {
    key: 'routing-key', id: 'sub_1', name: 'appointment.booked', arguments: {},
    definition: { name: 'appointment.booked', delivery: ['webhook'], inputSchema: {}, payloadSchema: {} },
    delivery: { mode: 'webhook', url: 'https://receiver.example/api/mcp-events?mcp_event_subscription=routing-key', secret: `whsec_${bytes.toString('base64')}` },
    cursor: 'opaque-before', truncated: false, status: 'active',
  };
  const sql = vi.fn(async (strings: TemplateStringsArray, ...args: unknown[]) => {
    if (strings.join('').startsWith('SELECT')) return [{ record: structuredClone(record) }];
    const patch = JSON.parse(args.find(value => typeof value === 'string' && value.startsWith('{')) as string);
    if (guards.pending && strings.join('').includes("::jsonb - 'status'") && record.status === 'active' && record.id && patch.status === 'pending') delete patch.status;
    if (guards.cursor && strings.join('').includes("::jsonb - 'cursor'") && record.status === 'active' && patch.status === 'active') delete patch.cursor;
    record = { ...record, ...patch };
    return [{ key: record.key }];
  });
  const store = createPostgresStore('https://sender.example/api/mcp', sql as unknown as ReturnType<typeof db>);
  const persist = vi.fn();
  const webhook = experimental_createMCPEventWebhook({ store, onEvent: persist });
  let duringRefresh: number | undefined;
  const client = await createMCPClient({
    experimental_events: { store },
    transport: { type: 'http', url: 'https://sender.example/api/mcp', fetch: async (_url, options) => {
      const rpc = JSON.parse(options?.body as string);
      if (rpc.id === undefined) return new Response(null, { status: 202 });
      let result: object;
      if (rpc.method === 'server/discover') {
        result = { supportedVersions: ['2026-07-28'], capabilities: { events: {} } };
      } else if (rpc.method === 'initialize') {
        result = { protocolVersion: '2025-11-25', capabilities: { events: {} }, serverInfo: { name: 'test', version: '1' } };
      } else {
        expect(rpc.method).toBe('events/subscribe');
        expect(rpc.params.cursor).toBe('opaque-before');
        const body = JSON.stringify({ eventId: 'evt_refresh', name: record.name, timestamp: new Date().toISOString(), data: {}, cursor: 'opaque-after' });
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = createHmac('sha256', bytes).update(`evt_refresh.${timestamp}.${body}`).digest('base64');
        duringRefresh = (await webhook(new Request(record.delivery.url, { method: 'POST', body, headers: {
          'content-type': 'application/json',
          'webhook-id': 'evt_refresh', 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}`, 'X-MCP-Subscription-Id': 'sub_1',
        } }))).status;
        result = { resultType: 'complete', id: 'sub_1', refreshBefore: null, cursor: rpc.params.cursor, truncated: false };
      }
      return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
    } },
  });
  try {
    await client.experimental_events.refresh({ key: record.key });
    expect(duringRefresh).toBe(guards.pending ? 204 : 503);
    expect(persist).toHaveBeenCalledTimes(guards.pending ? 1 : 0);
    expect(sql.mock.calls.some(call => call.includes('pending'))).toBe(true);
    expect(record.status).toBe('active');
    expect(record.cursor).toBe(guards.cursor ? 'opaque-after' : 'opaque-before');
  } finally { await client.close(); }
});
