import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../../../lib/stream', async importOriginal => {
  const original = await importOriginal<typeof import('../../../lib/stream')>();
  return { ...original, openFeedStream: mocks.open };
});
import { GET, maxDuration } from './route';

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
