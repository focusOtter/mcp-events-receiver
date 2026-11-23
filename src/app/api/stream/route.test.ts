import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ open: vi.fn(), capacity: vi.fn() }));
vi.mock('../../../lib/stream', async importOriginal => {
  const original = await importOriginal<typeof import('../../../lib/stream')>();
  return { ...original, openFeedStream: mocks.open, streamCapacityAvailable: mocks.capacity };
});
import { GET, maxDuration } from './route';
beforeEach(() => { vi.clearAllMocks(); mocks.capacity.mockResolvedValue(true); });

it('returns SSE headers, rejects invalid cursors and handles unavailable configuration', async () => {
  mocks.open.mockReturnValueOnce(new ReadableStream({ start(controller) { controller.close(); } }));
  const response = await GET(new Request('https://receiver/api/stream?after=42'));
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  expect(response.headers.get('cache-control')).toContain('no-transform');
  expect(maxDuration).toBe(60);
  expect((await GET(new Request('https://receiver/api/stream?after=bad'))).status).toBe(400);
  mocks.open.mockImplementationOnce(() => { throw new Error('Missing config'); });
  expect((await GET(new Request('https://receiver/api/stream'))).status).toBe(503);
});
it('returns 503 at capacity or on admission query failure without opening a listener', async () => {
  mocks.capacity.mockResolvedValueOnce(false);
  const response = await GET(new Request('https://receiver/api/stream'));
  expect(response.status).toBe(503);
  expect(response.headers.get('retry-after')).toBe('5');
  expect(await response.text()).toBe('Stream capacity reached');
  expect(mocks.open).not.toHaveBeenCalled();
  mocks.capacity.mockRejectedValueOnce(new Error('Database unavailable'));
  expect((await GET(new Request('https://receiver/api/stream'))).status).toBe(503);
  expect(mocks.open).not.toHaveBeenCalled();
});
