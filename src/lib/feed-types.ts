export type ReceivedEvent = {
  eventId: string; name: string; data: Record<string, unknown>; timestamp: string;
  receivedAt: string; cursor: string | null; summary: string | null; summaryStatus: string;
};
export type SubscriptionStatus = { id: string | null; name: string; status: string; refreshBefore: string | null };
export type Feed = { events: ReceivedEvent[]; subscriptions: SubscriptionStatus[]; total: number; asOf: number };
