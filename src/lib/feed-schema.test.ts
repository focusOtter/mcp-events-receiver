import { expect, it, vi } from 'vitest';
import type { db } from './db';
import { setupFeedStream } from './feed-schema';

it('atomically journals and notifies all feed writers, with commit-ordered cursors and no private payload', async () => {
  const sql = Object.assign(vi.fn().mockReturnValue({}), { transaction: vi.fn().mockResolvedValue([]) });
  await setupFeedStream(sql as unknown as ReturnType<typeof db>);
  expect(sql.transaction).toHaveBeenCalledOnce();
  const statements = sql.mock.calls.map(call => call[0].join('?')).join('\n');
  expect(statements).toContain('AFTER INSERT OR UPDATE ON received_events');
  expect(statements).toContain('AFTER INSERT OR UPDATE OR DELETE ON mcp_subscriptions');
  expect(statements).toContain('pg_advisory_xact_lock(3415, 1)');
  expect(statements).toContain("pg_notify('receiver_feed', json_build_object('id', change_id::text, 'kind', change_kind)::text)");
  expect(statements).not.toContain('secret');
});
