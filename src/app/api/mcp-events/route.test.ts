import { createHmac } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Experimental_MCPEventSubscription } from '@ai-sdk/mcp';

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), persist: vi.fn(), summarize: vi.fn(), jobs: [] as (() => Promise<void>)[] }));
vi.mock('../../../lib/store', () => ({ eventStore: () => ({ get: mocks.get, update: mocks.update }) }));
vi.mock('../../../lib/events', () => ({ persistEvent: mocks.persist }));
vi.mock('../../../lib/summaries', () => ({ summarizeEvent: mocks.summarize }));
vi.mock('next/server', () => ({ after: (job: () => Promise<void>) => mocks.jobs.push(job) }));
import { POST } from './route';

const bytes = Buffer.alloc(32, 7);
const subscription: Experimental_MCPEventSubscription = {
  key: 'routing-key', id: 'sub_1', name: 'appointment.booked', arguments: {},
  definition: { name: 'appointment.booked', delivery: ['webhook'], inputSchema: {}, payloadSchema: {} },
  delivery: { mode: 'webhook', url: 'https://receiver.example/api/mcp-events', secret: `whsec_${bytes.toString('base64')}` },
  cursor: null, truncated: false, status: 'active',
};
const event = { eventId: 'evt_1', name: 'appointment.booked', timestamp: new Date().toISOString(), data: { dogName: 'Biscuit', service: 'Full groom' }, cursor: '9' };
function request(value: unknown = event, signed = true) {
  const body = JSON.stringify(value);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', bytes).update(`evt_1.${timestamp}.${body}`).digest('base64');
  return new Request('https://receiver.example/api/mcp-events?mcp_event_subscription=routing-key', { method: 'POST', body,
    headers: { 'content-type': 'application/json', 'X-MCP-Subscription-Id': 'sub_1', ...(signed ? { 'webhook-id': 'evt_1', 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` } : {}) } });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.jobs.length = 0;
  mocks.get.mockResolvedValue(subscription); mocks.update.mockResolvedValue(undefined);
  mocks.persist.mockResolvedValue(true); mocks.summarize.mockResolvedValue(undefined);
});

it('accepts the sender Standard Webhooks signature with 204 and persists before scheduling AI', async () => {
  expect((await POST(request())).status).toBe(204);
  expect(mocks.persist).toHaveBeenCalledWith(event);
  expect(mocks.update).toHaveBeenCalledWith('routing-key', { cursor: '9' });
  expect(mocks.summarize).not.toHaveBeenCalled();
  await mocks.jobs[0]();
  expect(mocks.summarize).toHaveBeenCalledWith(event);
});
it('rejects unsigned deliveries with 401 before any event write', async () => {
  expect((await POST(request(event, false))).status).toBe(401);
  expect(mocks.persist).not.toHaveBeenCalled();
});
it('answers a signed verification challenge while subscription is pending', async () => {
  mocks.get.mockResolvedValue({ ...subscription, id: undefined, status: 'pending' });
  const response = await POST(request({ type: 'verification', challenge: 'nonce' }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ challenge: 'nonce' });
  expect(mocks.persist).not.toHaveBeenCalled();
});
it('deduplicates event IDs and only schedules one summary', async () => {
  const ids = new Set<string>();
  mocks.persist.mockImplementation(async (value: typeof event) => { if (ids.has(value.eventId)) return false; ids.add(value.eventId); return true; });
  expect((await POST(request())).status).toBe(204);
  expect((await POST(request())).status).toBe(204);
  expect(ids.size).toBe(1); expect(mocks.jobs).toHaveLength(1);
});
it('keeps the accepted event when background AI fails', async () => {
  mocks.summarize.mockRejectedValue(new Error('AI unavailable'));
  expect((await POST(request())).status).toBe(204);
  await expect(mocks.jobs[0]()).resolves.toBeUndefined();
});
it('returns 503 when persistence fails so the sender can retry', async () => {
  mocks.persist.mockRejectedValue(new Error('Database unavailable'));
  expect((await POST(request())).status).toBe(503);
  expect(mocks.jobs).toHaveLength(0);
});
it('rejects malformed event payloads and unknown routing keys', async () => {
  expect((await POST(request({}))).status).toBe(400);
  mocks.get.mockResolvedValue(undefined);
  expect((await POST(request())).status).toBe(401);
});
