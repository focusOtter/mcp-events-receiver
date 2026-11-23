import { experimental_createMCPEventWebhook } from '@ai-sdk/mcp';
import { after } from 'next/server';
import { eventStore } from './store';
import { persistEvent } from './events';
import { summarizeEvent } from './summaries';

export function createWebhook(dependencies = {
  store: eventStore(), persist: persistEvent, summarize: summarizeEvent,
  schedule: (job: () => Promise<void>) => after(job),
}) {
  return experimental_createMCPEventWebhook({
    store: dependencies.store,
    async onEvent({ event }) {
      const inserted = await dependencies.persist(event);
      if (inserted) dependencies.schedule(async () => {
        try { await dependencies.summarize(event); } catch {}
      });
    },
  });
}
