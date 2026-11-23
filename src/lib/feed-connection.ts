import type { FeedMessage } from './stream';

export function connectFeed(onMessage: (message: FeedMessage) => void, onConnection: (connected: boolean) => void) {
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let delay = 5000;
  let cursor = '';
  function close() {
    if (!source) return;
    source.onopen = source.onmessage = source.onerror = null;
    source.removeEventListener('rollover', rollover);
    source.close();
    source = undefined;
  }
  function rollover() {
    if (stopped) return;
    close();
    onConnection(false);
    connect();
  }
  function retry() {
    if (stopped) return;
    close();
    onConnection(false);
    timer = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 30000);
  }
  function connect() {
    if (stopped) return;
    try {
      source = new EventSource(`/api/stream${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`);
      source.onopen = () => { delay = 5000; onConnection(true); };
      source.onmessage = event => {
        if (event.lastEventId) cursor = event.lastEventId;
        onMessage(JSON.parse(event.data));
      };
      source.onerror = retry;
      source.addEventListener('rollover', rollover);
    } catch { retry(); }
  }
  connect();
  return () => { stopped = true; clearTimeout(timer); close(); };
}
