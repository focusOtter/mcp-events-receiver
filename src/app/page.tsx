import { Suspense } from 'react';
import { connection } from 'next/server';
import { readFeed } from '@/lib/events';
import type { Feed } from '@/lib/feed-types';
import { Receiver } from './receiver';

async function Content() {
  await connection();
  let initial: Feed = { events: [], subscriptions: [], total: 0, asOf: 0 };
  let initialError = '';
  try {
    initial = JSON.parse(JSON.stringify(await readFeed())) as Feed;
  } catch {
    initialError = 'The feed could not load. Retrying automatically…';
  }
  return <Receiver initial={initial} initialError={initialError} />;
}

export default function Home() {
  return <Suspense fallback={<main className="loading">Opening the listening room…</main>}><Content /></Suspense>;
}
