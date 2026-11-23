import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FeedMessage } from '../src/lib/stream';

const receiver = process.argv[2] ?? 'https://mcp-events-receiver-two.vercel.app';
const sender = 'https://mcp-events-dog-booking.vercel.app/api/mcp';
const dogName = `Biscuit SSE ${randomUUID().slice(0, 6)}`;
const abort = new AbortController();
const timeout = setTimeout(() => abort.abort(), 45000);
const arrivals: { message: FeedMessage; at: number; cursor: string }[] = [];
let wake: (() => void) | undefined;
let appointmentId: string | undefined;
async function rpc(name: string, args: Record<string, unknown>) {
  const response = await fetch(sender, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const value = await response.json();
  assert.equal(response.status, 200);
  assert.equal(value.error, undefined, JSON.stringify(value.error));
  return value.result.structuredContent;
}
async function waitFor(predicate: (message: FeedMessage) => boolean) {
  for (;;) {
    const found = arrivals.find(row => predicate(row.message));
    if (found) return found;
    if (abort.signal.aborted) throw new Error('SSE check timed out');
    await new Promise<void>(resolve => {
      const done = () => { abort.signal.removeEventListener('abort', done); resolve(); };
      wake = done;
      abort.signal.addEventListener('abort', done, { once: true });
    });
  }
}
async function* chunks(response: Response) {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function consume(response: Response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  let buffer = '';
  let last = '0';
  for await (const chunk of chunks(response)) {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const data = frame.split('\n').find(line => line.startsWith('data: '));
      if (!data) continue;
      const cursor = frame.split('\n').find(line => line.startsWith('id: '))?.slice(4);
      if (cursor) { assert(BigInt(cursor) > BigInt(last), 'SSE IDs must increase'); last = cursor; }
      arrivals.push({ message: JSON.parse(data.slice(6)), at: Date.now(), cursor: last });
      wake?.();
    }
  }
}

let reading: Promise<void> | undefined;
try {
  const response = await fetch(`${receiver}/api/stream`, { signal: abort.signal });
  reading = consume(response);
  void reading.catch(() => { abort.abort(); });
  const initial = (await waitFor(message => message.kind === 'snapshot')).message;
  assert(initial.kind === 'snapshot');
  assert.equal(initial.feed.subscriptions.filter(subscription => subscription.status === 'active').length, 2, 'Refresh the canonical receiver subscriptions before running');
  const started = Date.now();
  const result = await rpc('book_appointment', { dogName, ownerName: 'Fictional SSE demo friend', service: 'Full groom', startsAt: new Date(Date.now() + 86400000).toISOString() });
  appointmentId = result.appointment.id;
  const booked = await waitFor(message => message.kind === 'event' && message.event.name === 'appointment.booked' && message.event.data.id === appointmentId);
  console.log(`PASS booking → SSE message: ${booked.at - started}ms (cursor ${booked.cursor})`);
  const cancelledAt = Date.now();
  await rpc('cancel_appointment', { id: appointmentId });
  const cancelled = await waitFor(message => message.kind === 'event' && message.event.name === 'appointment.cancelled' && message.event.data.id === appointmentId);
  appointmentId = undefined;
  console.log(`PASS cancellation → SSE message: ${cancelled.at - cancelledAt}ms (cursor ${cancelled.cursor})`);
  const summary = await waitFor(message => message.kind === 'event' && message.event.data.dogName === dogName && message.event.summaryStatus !== 'pending');
  assert(summary.message.kind === 'event');
  console.log(`PASS AI summary outcome pushed over SSE: ${summary.message.event.summaryStatus}`);
  const replayAbort = new AbortController();
  try {
    const replay = await fetch(`${receiver}/api/stream`, { signal: AbortSignal.any([abort.signal, replayAbort.signal]), headers: { 'Last-Event-ID': booked.cursor } });
    assert.equal(replay.status, 200);
    let body = '';
    for await (const chunk of chunks(replay)) {
      body += chunk;
      if (body.includes(`id: ${cancelled.cursor}\n`)) break;
    }
    assert(body.includes(`id: ${cancelled.cursor}\n`));
    console.log(`PASS Last-Event-ID catch-up replays cancellation cursor ${cancelled.cursor}`);
  } finally { replayAbort.abort(); }
  console.log('PASS deployed SSE book → feed → cancel; no /api/feed requests used.');
} finally {
  clearTimeout(timeout);
  abort.abort();
  await reading?.catch(() => {});
  if (appointmentId) await rpc('cancel_appointment', { id: appointmentId });
}
