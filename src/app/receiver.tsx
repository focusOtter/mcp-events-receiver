'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Feed } from '@/lib/feed-types';
import { applyFeedMessage } from '@/lib/feed-updates';
import { connectFeed } from '@/lib/feed-connection';
import { subscriptionAction } from './actions';

function Signal({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="16" cy="16" r="2" fill="currentColor" /><path d="M10 10a8.5 8.5 0 0 0 0 12m12-12a8.5 8.5 0 0 1 0 12M5.5 5.5a15 15 0 0 0 0 21m21-21a15 15 0 0 1 0 21" /></svg>;
}

function date(value: unknown, options: Intl.DateTimeFormatOptions) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return 'Time unavailable';
  return new Date(value).toLocaleString('en-US', { ...options, timeZone: 'UTC' });
}

export function Receiver({ initial, initialError = '' }: { initial: Feed; initialError?: string }) {
  const [feed, setFeed] = useState(initial);
  const [error, setError] = useState(initialError);
  const [connected, setConnected] = useState(false);
  const [state, action, pending] = useActionState(subscriptionAction, {});
  useEffect(() => {
    return connectFeed(
      message => setFeed(current => applyFeedMessage(current, message)),
      connected => {
        setConnected(connected);
        setError(connected ? '' : 'Connection interrupted. Your events are safe; reconnecting…');
      },
    );
  }, []);
  const active = feed.subscriptions.filter(s => s.status === 'active' && (!s.refreshBefore || Date.parse(s.refreshBefore) > feed.asOf)).length;
  return <>
    <header className="topbar"><Link href="/" className="brand"><span className="brand-icon"><Signal /></span>otter paws<span className="brand-divider" />listening room</Link><span className="site-label">MCP Events · receiver</span></header>
    <main className="workspace">
      <aside className="connection">
        <div className="connection-title"><Signal /><h1>A little closer.<br />In real time.</h1></div>
        <p className="intro">From a fresh booking to a change of plans. Every little update lands here.</p>
        <div className="path"><span>Otter Paws booking</span><svg viewBox="0 0 20 35" aria-hidden="true"><path d="M10 0v30m-5-5 5 5 5-5" fill="none" stroke="currentColor" /></svg><strong>This listening room</strong><small>Signed webhook · verified on arrival</small></div>
        <form action={action} className="controls"><button className="primary" name="mode" value="subscribe" disabled={pending}>{pending ? 'Updating subscriptions…' : active ? 'Refresh subscriptions' : 'Subscribe to events'}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13 13 3M4 3h9v9" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg></button><button className="secondary" name="mode" value="unsubscribe" disabled={pending || feed.subscriptions.length === 0}>Unsubscribe</button></form>
        <div className="action-message" aria-live="polite">{state.message && <p>{state.message}</p>}{state.error && <p role="alert" className="error">{state.error}</p>}</div>
        <section className="subscriptions"><h2>Subscriptions <span>{active}/2 active</span></h2>{feed.subscriptions.length === 0 ? <p className="muted">Not listening yet. Subscribe to follow bookings and cancellations.</p> : feed.subscriptions.map((subscription, index) => {
          const expired = subscription.refreshBefore && Date.parse(subscription.refreshBefore) <= feed.asOf;
          return <div className="subscription" key={subscription.id ?? `${subscription.name}-${index}`}><div className="subscription-name"><i className={subscription.status === 'active' && !expired ? 'dot' : 'dot inactive'} /><code>{subscription.name}</code></div><p>{expired ? 'Expired — refresh to reconnect' : subscription.status === 'active' ? 'Listening' : 'Awaiting verification'}</p><code className="subscription-id">{subscription.id ?? 'ID pending'}</code><small>Refresh before {subscription.refreshBefore ? `${date(subscription.refreshBefore, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} UTC` : 'no expiry'}</small></div>;
        })}</section>
        <div className="under-the-hood"><h2>Good data. A friendly voice.</h2><p>Events are saved first. The AI SDK adds a short summary through AI Gateway when available. No summary? No lost event.</p><code>@ai-sdk/mcp 2.0.103</code></div>
      </aside>
      <section className="feed" aria-label="Received event feed"><div className="feed-heading"><div><h2>The latest tail wags.</h2><p>A live feed from the grooming club.</p></div><span className={connected ? 'live' : 'live offline'}><i className="dot" />{connected ? 'Live · streaming' : 'Reconnecting…'}</span></div>
        <div className="feed-meta"><span>{feed.total} event{feed.total !== 1 ? 's' : ''} received</span><span>Newest first · all times UTC</span></div>
        {error && <p role="status" className="feed-error">{error}</p>}
        {feed.events.length === 0 ? <div className="empty"><Signal /><h3>Ready when the good dogs are.</h3><p>Subscribe, then book an appointment on site 1.<br />The signed event will appear right here.</p><div className="empty-envelope"><code>appointment.booked</code><span>Waiting for the first arrival</span></div></div> : <div className="event-list">{feed.events.map(event => {
          const cancelled = event.name.endsWith('cancelled');
          const dog = typeof event.data.dogName === 'string' ? event.data.dogName : 'A good dog';
          return <article className={`event-card ${cancelled ? 'cancelled' : 'booked'}`} key={event.eventId}><div className="card-top"><span className="event-kind"><svg viewBox="0 0 20 20" aria-hidden="true"><path d={cancelled ? 'm6 6 8 8M14 6l-8 8' : 'm5 10 3 3 7-7'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>Appointment {cancelled ? 'cancelled' : 'booked'}</span><time dateTime={event.receivedAt}>{date(event.receivedAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div><h3>{dog}&apos;s appointment {cancelled ? 'was cancelled' : 'is booked'}.</h3><p className="appointment-info">{String(event.data.service ?? 'Grooming')}<span>·</span>{date(event.data.startsAt, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
            {event.summary ? <div className="ai-summary"><span>AI note</span><p>{event.summary}</p></div> : <p className="summary-fallback">{event.summaryStatus === 'pending' ? 'A friendly AI note is on its way…' : 'Saved safely. AI note unavailable for this event.'}</p>}
            <details><summary>View raw event <code>{event.eventId.slice(0, 8)}…</code></summary><pre>{JSON.stringify({ eventId: event.eventId, name: event.name, timestamp: event.timestamp, data: event.data, cursor: event.cursor, received_at: event.receivedAt }, null, 2)}</pre></details></article>;
        })}</div>}
        <footer className="feed-footer"><span>Verified with Standard Webhooks v1</span><code>POST /api/mcp-events</code></footer>
      </section>
    </main><footer className="footer"><span>Built for good dogs & curious developers.</span><span>Shared demo · fictional names only</span></footer>
  </>;
}
