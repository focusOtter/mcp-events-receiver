import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectFeed } from './feed-connection';

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  addEventListener = vi.fn<(type: string, listener: () => void) => void>();
  removeEventListener = vi.fn<(type: string, listener: () => void) => void>();
  constructor(public url: string) { MockEventSource.instances.push(this); }
}
const latest = () => MockEventSource.instances.at(-1)!;
beforeEach(() => { vi.useFakeTimers(); MockEventSource.instances = []; vi.stubGlobal('EventSource', MockEventSource); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(['', '9007199254740993'])('immediately rolls over with saved cursor %s and keeps backoff for a subsequent failure', async cursor => {
  const receive = vi.fn();
  const stop = connectFeed(receive, vi.fn());
  const previous = latest();
  previous.onopen!();
  if (cursor) previous.onmessage!({ data: JSON.stringify({ kind: 'snapshot', feed: {} }), lastEventId: cursor });
  const rollover = previous.addEventListener.mock.calls[0][1] as () => void;
  expect(previous.addEventListener.mock.calls[0][0]).toBe('rollover');
  receive.mockClear();
  rollover();
  expect(previous.close).toHaveBeenCalledOnce();
  expect(previous.removeEventListener).toHaveBeenCalledWith('rollover', rollover);
  expect(latest()).not.toBe(previous);
  expect(latest().url).toBe(`/api/stream${cursor ? `?after=${cursor}` : ''}`);
  expect(receive).not.toHaveBeenCalled();
  const replacement = latest();
  replacement.onerror!();
  await vi.advanceTimersByTimeAsync(4999);
  expect(latest()).toBe(replacement);
  await vi.advanceTimersByTimeAsync(1);
  expect(latest()).not.toBe(replacement);
  stop();
  const count = MockEventSource.instances.length;
  rollover();
  expect(MockEventSource.instances).toHaveLength(count);
});

it('backs off failed/503 connections from 5s to 30s, then resets after success', async () => {
  const status = vi.fn();
  const stop = connectFeed(vi.fn(), status);
  for (const wait of [5000, 10000, 20000, 30000, 30000]) {
    const previous = latest();
    previous.onerror!();
    expect(previous.close).toHaveBeenCalledOnce();
    expect(status).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(wait - 1);
    expect(latest()).toBe(previous);
    await vi.advanceTimersByTimeAsync(1);
    expect(latest()).not.toBe(previous);
  }
  latest().onopen!();
  expect(status).toHaveBeenLastCalledWith(true);
  const previous = latest();
  previous.onerror!();
  await vi.advanceTimersByTimeAsync(5000);
  expect(latest()).not.toBe(previous);
  stop();
});
it('preserves the last cursor on manual reconnect and delivers summary updates', async () => {
  const receive = vi.fn();
  const stop = connectFeed(receive, vi.fn());
  expect(latest().url).toBe('/api/stream');
  const message = { kind: 'subscriptions', subscriptions: [], asOf: 1 };
  latest().onmessage!({ data: JSON.stringify(message), lastEventId: '9007199254740993' });
  expect(receive).toHaveBeenCalledWith(message);
  latest().onerror!();
  await vi.advanceTimersByTimeAsync(5000);
  expect(latest().url).toBe('/api/stream?after=9007199254740993');
  stop();
  expect(latest().close).toHaveBeenCalledOnce();
});
it('cancels pending retries on cleanup and handles a constructor failure', async () => {
  const factory = vi.fn(function () { throw new Error('Connection failed'); });
  vi.stubGlobal('EventSource', factory);
  const status = vi.fn();
  const stop = connectFeed(vi.fn(), status);
  expect(status).toHaveBeenCalledWith(false);
  stop();
  await vi.advanceTimersByTimeAsync(30000);
  expect(factory).toHaveBeenCalledOnce();
});
