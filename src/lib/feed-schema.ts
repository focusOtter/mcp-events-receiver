import { db } from './db';

export async function setupFeedStream(sql = db()) {
  await sql.transaction([
    sql`CREATE TABLE IF NOT EXISTS receiver_feed_changes (
      cursor bigserial PRIMARY KEY, kind text NOT NULL, entity_id text NOT NULL, scope text NOT NULL)`,
    sql`CREATE OR REPLACE FUNCTION notify_receiver_feed() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE change_id bigint; change_kind text; entity text; change_scope text;
      BEGIN
        IF TG_TABLE_NAME = 'received_events' THEN
          change_kind := 'event'; entity := NEW.event_id; change_scope := '';
        ELSE
          IF TG_OP = 'UPDATE' AND
            jsonb_build_array(OLD.record->'id', OLD.record->'name', OLD.record->'status', OLD.record->'refreshBefore')
            IS NOT DISTINCT FROM
            jsonb_build_array(NEW.record->'id', NEW.record->'name', NEW.record->'status', NEW.record->'refreshBefore')
          THEN RETURN NULL; END IF;
          change_kind := 'subscriptions';
          IF TG_OP = 'DELETE' THEN change_scope := OLD.scope; ELSE change_scope := NEW.scope; END IF;
          entity := change_scope;
        END IF;
        -- Serialize cursor allocation through commit, not just sequence allocation.
        PERFORM pg_advisory_xact_lock(3415, 1);
        INSERT INTO receiver_feed_changes(kind, entity_id, scope)
          VALUES (change_kind, entity, change_scope) RETURNING cursor INTO change_id;
        PERFORM pg_notify('receiver_feed', json_build_object('id', change_id::text, 'kind', change_kind)::text);
        RETURN NULL;
      END $$`,
    sql`DROP TRIGGER IF EXISTS receiver_event_changed ON received_events`,
    sql`CREATE TRIGGER receiver_event_changed AFTER INSERT OR UPDATE ON received_events
      FOR EACH ROW EXECUTE FUNCTION notify_receiver_feed()`,
    sql`DROP TRIGGER IF EXISTS receiver_subscription_changed ON mcp_subscriptions`,
    sql`CREATE TRIGGER receiver_subscription_changed AFTER INSERT OR UPDATE OR DELETE ON mcp_subscriptions
      FOR EACH ROW EXECUTE FUNCTION notify_receiver_feed()`,
  ]);
}
