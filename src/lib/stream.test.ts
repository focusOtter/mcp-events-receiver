import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Client } from '@neondatabase/serverless';
const mocks = vi.hoisted(() => ({ sql: vi.fn(), feed: vi.fn() }));
vi.mock('./db', () => ({ db: () => mocks.sql, serverUrl: () => 'https://sender.example/api/mcp' }));
vi.mock('./events', () => ({ readFeed: mocks.feed }));
import { formatMessage, listenerClient, loadChange, openFeedStream, readChanges, resumeCursor } from './stream';
import { applyFeedMessage } from './feed-updates';
import type { Feed, ReceivedEvent } from './feed-types';

const feed: Feed = { events: [], subscriptions: [], total: 0, asOf: 1 };
const event: ReceivedEvent = { eventId: 'evt-1', name: 'appointment.booked', data: { dogName: 'Biscuit' }, timestamp: '2026-11-23T00:00:00Z', receivedAt: '2026-11-23T00:00:00Z', cursor: '1', summary: null, summaryStatus: 'pending' };
function client() {
  return Object.assign(new EventEmitter(), { connect: vi.fn().mockResolvedValue(undefined), query: vi.fn().mockResolvedValue({ rows: [] }), end: vi.fn().mockResolvedValue(undefined) });
}
beforeEach(() => { vi.useFakeTimers(); mocks.sql.mockReset().mockImplementation((query: TemplateStringsArray) => Promise.resolve(query.join('').includes('MAX(cursor)') ? [{ cursor: '0' }] : [])); mocks.feed.mockReset().mockResolvedValue(feed); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it('honors Last-Event-ID over after, preserves bigint precision and rejects invalid cursors', () => {
  expect(resumeCursor(new Request('https://receiver/api/stream'))).toBe('0');
  expect(resumeCursor(new Request('https://receiver/api/stream?after=42'))).toBe('42');
  expect(resumeCursor(new Request('https://receiver/api/stream?after=42', { headers: { 'last-event-id': '9007199254740993' } }))).toBe('9007199254740993');
  for (const value of ['-1', '1\n', '1.5', '9223372036854775808', 'abc', '']) {
    expect(() => resumeCursor(new Request(`https://receiver/api/stream?after=${encodeURIComponent(value)}`))).toThrow('Invalid stream cursor');
  }
});
it('formats safe SSE frames and upserts summaries without duplicates or changing arrival order', () => {
  const message = { kind: 'event' as const, event, total: 1, asOf: 2 };
  expect(formatMessage(message, '42')).toBe(`id: 42\ndata: ${JSON.stringify(message)}\n\n`);
  expect(formatMessage({ kind: 'snapshot', feed })).not.toContain('id:');
  const inserted = applyFeedMessage(feed, message);
  const updated = applyFeedMessage(inserted, { ...message, event: { ...event, summary: 'Hello\nworld', summaryStatus: 'complete' } });
  expect(updated.events).toHaveLength(1);
  expect(updated.events[0].summary).toBe('Hello\nworld');
  expect(applyFeedMessage(updated, { kind: 'subscriptions', subscriptions: [], asOf: 3 }).events).toEqual(updated.events);
  expect(applyFeedMessage(updated, { kind: 'snapshot', feed })).toEqual(feed);
});
it('queries only changes strictly after the cursor, ordered, scoped and bounded', async () => {
  await readChanges('42');
  expect(mocks.sql.mock.calls[0][0].join('?')).toContain('cursor > ?::bigint');
  expect(mocks.sql.mock.calls[0][0].join('?')).toContain('ORDER BY receiver_feed_changes.cursor LIMIT 100');
  expect(mocks.sql.mock.calls[0].slice(1)).toEqual(['42', 'https://sender.example/api/mcp']);
});
it('loads current event rows and only public subscription fields; handles removed rows and DB errors', async () => {
  mocks.sql.mockResolvedValueOnce([event]).mockResolvedValueOnce([{ total: 4 }]);
  expect(await loadChange('event', 'evt-1')).toMatchObject({ kind: 'event', event, total: 4 });
  expect(await loadChange('event', 'missing')).toBeUndefined();
  await loadChange('subscriptions', 'scope');
  expect(mocks.sql.mock.calls[3][0].join('?')).not.toContain('secret');
  mocks.sql.mockRejectedValueOnce(new Error('DB offline'));
  await expect(readChanges('0')).rejects.toThrow('DB offline');
});
it('requires an explicitly unpooled connection URL', () => {
  vi.stubEnv('DATABASE_URL_UNPOOLED', '');
  expect(listenerClient).toThrow('DATABASE_URL_UNPOOLED');
  vi.stubEnv('DATABASE_URL_UNPOOLED', 'postgresql://user:pass@ep-test-pooler.example.neon.tech/receiver');
  expect(listenerClient).toThrow('direct Neon URL');
});
it('LISTENs before catch-up, sends ordered IDs, drains notifications, pings and releases on abort', async () => {
  const connection = client();
  const abort = new AbortController();
  mocks.sql.mockResolvedValueOnce([{ cursor: '43', kind: 'event', entity_id: 'evt-1' }])
    .mockResolvedValueOnce([event]).mockResolvedValueOnce([{ total: 1 }]);
  const reader = openFeedStream(new Request('https://receiver/api/stream', { signal: abort.signal }), '42', connection as unknown as Client).getReader();
  const decode = async () => new TextDecoder().decode((await reader.read()).value);
  expect(await decode()).toContain('retry: 1000');
  expect(await decode()).toContain('"kind":"snapshot"');
  expect(await decode()).toContain('id: 43\n');
  expect(connection.query).toHaveBeenCalledWith('LISTEN receiver_feed');
  await vi.advanceTimersByTimeAsync(25000);
  expect(await decode()).toBe(': ping\n\n');
  connection.emit('notification', { payload: '{"id":"44"}' });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.sql.mock.calls.at(-1)?.slice(1)[0]).toBe('43');
  abort.abort();
  expect((await reader.read()).done).toBe(true);
  expect(connection.end).toHaveBeenCalledOnce();
});
it('closes before the function deadline, on listener failure, cancellation and early abort', async () => {
  for (const mode of ['deadline', 'error', 'cancel', 'abort'] as const) {
    const connection = client();
    const abort = new AbortController();
    if (mode === 'abort') abort.abort();
    const reader = openFeedStream(new Request('https://receiver/api/stream', { signal: abort.signal }), '0', connection as unknown as Client, 500).getReader();
    await vi.advanceTimersByTimeAsync(0);
    if (mode === 'deadline') await vi.advanceTimersByTimeAsync(500);
    if (mode === 'error') connection.emit('error', new Error('Disconnected'));
    if (mode === 'cancel') await reader.cancel();
    expect(connection.end).toHaveBeenCalledOnce();
  }
});
it('does not miss a notification arriving during catch-up and closes on a catch-up DB error', async () => {
  const connection = client();
  let release!: (rows: unknown[]) => void;
  mocks.sql.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
    .mockResolvedValueOnce([event]).mockResolvedValueOnce([{ total: 1 }]);
  const reader = openFeedStream(new Request('https://receiver/api/stream'), '42', connection as unknown as Client).getReader();
  await reader.read();
  await reader.read();
  connection.emit('notification');
  release([{ cursor: '43', kind: 'event', entity_id: event.eventId }]);
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('id: 43');
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.sql.mock.calls.at(-1)?.slice(1)[0]).toBe('43');
  mocks.sql.mockRejectedValueOnce(new Error('DB offline'));
  connection.emit('notification');
  await vi.advanceTimersByTimeAsync(0);
  expect((await reader.read()).done).toBe(true);
  expect(connection.end).toHaveBeenCalledOnce();
});
it.each(['0', '9007199254740993'])('starts a fresh stream at journal head %s before the snapshot and catches concurrent writes without replay', async head => {
  const connection = client();
  const next = (BigInt(head) + BigInt(1)).toString();
  let releaseSnapshot!: (value: Feed) => void;
  mocks.sql.mockResolvedValueOnce([{ cursor: head }])
    .mockResolvedValueOnce([{ cursor: next, kind: 'event', entity_id: event.eventId }])
    .mockResolvedValueOnce([event]).mockResolvedValueOnce([{ total: 1 }]);
  mocks.feed.mockImplementationOnce(() => {
    expect(connection.query).toHaveBeenCalledWith('LISTEN receiver_feed');
    expect(mocks.sql).toHaveBeenCalledOnce();
    expect(mocks.sql.mock.calls[0][0].join('')).toContain('COALESCE(MAX(cursor), 0)::text');
    return new Promise(resolve => { releaseSnapshot = resolve; });
  });
  const reader = openFeedStream(new Request('https://receiver/api/stream'), '0', connection as unknown as Client).getReader();
  await reader.read();
  await vi.advanceTimersByTimeAsync(0);
  connection.emit('notification');
  releaseSnapshot(feed);
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(formatMessage({ kind: 'snapshot', feed }, head));
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(`id: ${next}\n`);
  expect(mocks.sql.mock.calls[1].slice(1)[0]).toBe(head);
  await reader.cancel();
});
it('closes a fresh stream without sending a snapshot if the journal head cannot be read', async () => {
  const connection = client();
  mocks.sql.mockRejectedValueOnce(new Error('DB offline'));
  const reader = openFeedStream(new Request('https://receiver/api/stream'), '0', connection as unknown as Client).getReader();
  await reader.read();
  expect((await reader.read()).done).toBe(true);
  expect(mocks.feed).not.toHaveBeenCalled();
  expect(connection.end).toHaveBeenCalledOnce();
});
