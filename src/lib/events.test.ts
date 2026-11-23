import { expect, it, vi } from 'vitest';
const sql = vi.hoisted(() => vi.fn());
vi.mock('./db', () => ({ db: () => sql }));
import { persistEvent } from './events';

it('inserts an event once using the database primary key, never overwriting a summary on retries', async () => {
  const event = { eventId: 'evt_1', name: 'appointment.booked', timestamp: new Date().toISOString(), data: { dogName: 'Biscuit' }, cursor: '3' };
  sql.mockResolvedValueOnce([{ event_id: 'evt_1' }]).mockResolvedValueOnce([]);
  expect(await persistEvent(event)).toBe(true);
  expect(await persistEvent(event)).toBe(false);
  expect(sql.mock.calls[0][0].join('?')).toContain('ON CONFLICT(event_id) DO NOTHING');
});
