import type { Feed } from './feed-types';
import type { FeedMessage } from './stream';

export function applyFeedMessage(feed: Feed, message: FeedMessage): Feed {
  if (message.kind === 'snapshot') return message.feed;
  if (message.kind === 'subscriptions') return { ...feed, subscriptions: message.subscriptions, asOf: message.asOf };
  const events = [message.event, ...feed.events.filter(event => event.eventId !== message.event.eventId)]
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || b.eventId.localeCompare(a.eventId))
    .slice(0, 50);
  return { ...feed, events, total: message.total, asOf: message.asOf };
}
