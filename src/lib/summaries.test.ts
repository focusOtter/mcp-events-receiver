import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ sql: vi.fn(), generate: vi.fn() }));
vi.mock('./db', () => ({ db: () => mocks.sql }));
vi.mock('ai', () => ({ gateway: (name: string) => name, generateText: mocks.generate }));
import { summarizeEvent } from './summaries';
const event = { eventId: 'evt_1', name: 'appointment.booked', timestamp: new Date().toISOString(), data: { dogName: 'Biscuit', service: 'Full groom', ownerName: 'Private demo owner' } };
beforeEach(() => { vi.clearAllMocks(); mocks.sql.mockResolvedValue([]); vi.stubEnv('VERCEL_OIDC_TOKEN', ''); vi.stubEnv('AI_GATEWAY_API_KEY', ''); });
afterEach(() => vi.unstubAllEnvs());
it('skips AI locally when credentials are absent', async () => {
  await summarizeEvent(event);
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.sql.mock.calls[0][0].join('?')).toContain("summary_status = 'unavailable'");
});
it('saves a one-line summary without sending the owner name', async () => {
  vi.stubEnv('VERCEL_OIDC_TOKEN', 'test-oidc'); mocks.generate.mockResolvedValue({ text: 'Biscuit is booked for a full groom!' });
  await summarizeEvent(event);
  expect(mocks.generate.mock.calls[0][0].prompt).not.toContain('Private demo owner');
  expect(mocks.sql.mock.calls[0].slice(1)).toEqual(['Biscuit is booked for a full groom!', 'evt_1']);
});
it('records an unavailable summary without rejecting when AI fails', async () => {
  vi.stubEnv('AI_GATEWAY_API_KEY', 'test-key'); mocks.generate.mockRejectedValue(new Error('Unavailable'));
  await expect(summarizeEvent(event)).resolves.toBeUndefined();
  expect(mocks.sql.mock.calls[0][0].join('?')).toContain("summary_status = 'unavailable'");
});
