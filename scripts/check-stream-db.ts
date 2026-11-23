import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { listenerClient } from '../src/lib/stream';

const listener = listenerClient();
const writer = listenerClient();
const eventId = `stream-check-${randomUUID()}`;
const scope = `stream-check-${randomUUID()}`;
const notifications: { id: string; kind: string }[] = [];
listener.on('notification', message => notifications.push(JSON.parse(message.payload!)));
async function notificationFor(write: () => Promise<unknown>, kind: string) {
  const notification = new Promise<{ id: string; kind: string }>((resolve, reject) => {
    const timer = setTimeout(() => { listener.removeListener('notification', onNotification); reject(new Error('LISTEN timed out')); }, 5000);
    function onNotification(message: { payload?: string }) {
      clearTimeout(timer);
      listener.removeListener('notification', onNotification);
      resolve(JSON.parse(message.payload!));
    }
    listener.on('notification', onNotification);
  });
  await write();
  const message = await notification;
  assert.equal(message.kind, kind);
  assert.match(message.id, /^\d+$/);
  return message.id;
}

try {
  await Promise.all([listener.connect(), writer.connect()]);
  await listener.query('LISTEN receiver_feed');
  await writer.query('BEGIN');
  await writer.query("INSERT INTO received_events(event_id,name,data,event_timestamp) VALUES ($1,'appointment.booked','{}',now())", [`${eventId}-rollback`]);
  await writer.query('ROLLBACK');
  assert.equal((await writer.query('SELECT * FROM receiver_feed_changes WHERE entity_id = $1', [`${eventId}-rollback`])).rowCount, 0);
  const first = await notificationFor(() => writer.query("INSERT INTO received_events(event_id,name,data,event_timestamp) VALUES ($1,'appointment.booked','{}',now())", [eventId]), 'event');
  const summary = await notificationFor(() => writer.query("UPDATE received_events SET summary='Test summary', summary_status='complete' WHERE event_id=$1", [eventId]), 'event');
  await notificationFor(() => writer.query("UPDATE received_events SET summary_status='unavailable' WHERE event_id=$1", [eventId]), 'event');
  await notificationFor(() => writer.query('INSERT INTO mcp_subscriptions(scope,key,record) VALUES ($1,$2,$3)', [scope, 'key', JSON.stringify({ name: 'test', status: 'pending' })]), 'subscriptions');
  await notificationFor(() => writer.query("UPDATE mcp_subscriptions SET record=record || '{\"status\":\"active\"}' WHERE scope=$1", [scope]), 'subscriptions');
  await notificationFor(() => writer.query('DELETE FROM mcp_subscriptions WHERE scope=$1', [scope]), 'subscriptions');
  assert(BigInt(summary) > BigInt(first));
  assert.equal(notifications.length, 6);
  console.log('PASS direct Neon WebSocket LISTEN: insert, summary success/failure, subscription set/update/delete; rollback emits no durable change.');
} finally {
  await writer.query('ROLLBACK');
  await writer.query('DELETE FROM received_events WHERE event_id=$1', [eventId]);
  await writer.query('DELETE FROM mcp_subscriptions WHERE scope=$1', [scope]);
  await writer.query('DELETE FROM receiver_feed_changes WHERE entity_id=$1 OR scope=$2', [eventId, scope]);
  await Promise.all([listener.end(), writer.end()]);
}
