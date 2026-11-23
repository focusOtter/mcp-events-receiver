import { beforeEach, expect, it, vi } from 'vitest';
import type { Experimental_MCPEventSubscription } from '@ai-sdk/mcp';
import type { db } from './db';
import { createPostgresStore } from './store';

const sql = vi.fn();
const store = createPostgresStore('https://sender.example/api/mcp', sql as unknown as ReturnType<typeof db>);
const subscription: Experimental_MCPEventSubscription = {
  key: 'routing-key', id: 'sub_1', name: 'appointment.booked', arguments: {},
  definition: { name: 'appointment.booked', delivery: ['webhook'], inputSchema: {}, payloadSchema: {} },
  delivery: { mode: 'webhook', url: 'https://receiver.example/api/mcp-events', secret: `whsec_${Buffer.alloc(32, 7).toString('base64')}` },
  cursor: null, truncated: false, status: 'active',
};
beforeEach(() => { sql.mockReset(); });

it('round-trips the full private subscription record by key and id', async () => {
  sql.mockResolvedValue([]);
  await store.set(subscription);
  expect(sql.mock.calls[0].slice(1)).toEqual(['https://sender.example/api/mcp', subscription.key, JSON.stringify(subscription)]);
  sql.mockResolvedValue([{ record: subscription }]);
  expect(await store.get(subscription.key)).toEqual(subscription);
  expect(await store.getById('sub_1')).toEqual(subscription);
  expect(sql.mock.calls[2].slice(1)).toEqual(['https://sender.example/api/mcp', 'sub_1']);
});
it('returns undefined for unknown keys and IDs and deletes idempotently', async () => {
  sql.mockResolvedValue([]);
  expect(await store.get('missing')).toBeUndefined();
  expect(await store.getById('missing')).toBeUndefined();
  await store.delete('missing');
  expect(sql.mock.calls[2].slice(1)).toEqual(['https://sender.example/api/mcp', 'missing']);
});
it('atomically merges only the supplied fields in Postgres, without a read/replace race', async () => {
  sql.mockResolvedValue([{ key: subscription.key }]);
  await store.update(subscription.key, { cursor: '42' });
  expect(sql).toHaveBeenCalledTimes(1);
  expect(sql.mock.calls[0][0].join('?')).toContain('record = record ||');
  expect(sql.mock.calls[0].slice(1)).toEqual([null, '{"cursor":"42"}', '{"cursor":"42"}', 'https://sender.example/api/mcp', subscription.key]);
});
it('atomically preserves an already-active record when the SDK marks a refresh pending', async () => {
  sql.mockResolvedValue([{ key: subscription.key }]);
  await store.update(subscription.key, { status: 'pending' });
  expect(sql).toHaveBeenCalledOnce();
  const query = sql.mock.calls[0][0].join('?');
  expect(query).toContain("record->>'status' = 'active' AND record->>'id' IS NOT NULL");
  expect(query).toContain("::jsonb - 'status'");
  expect(sql.mock.calls[0].slice(1)).toEqual(['pending', '{"status":"pending"}', '{"status":"pending"}', 'https://sender.example/api/mcp', subscription.key]);
});
it('rejects updates to missing records and propagates database failures', async () => {
  sql.mockResolvedValue([]);
  await expect(store.update('missing', { cursor: '3' })).rejects.toThrow('Unknown subscription');
  sql.mockRejectedValue(new Error('Database unavailable'));
  await expect(store.set(subscription)).rejects.toThrow('Database unavailable');
});
