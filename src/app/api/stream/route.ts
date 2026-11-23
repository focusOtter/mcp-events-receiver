import { openFeedStream, resumeCursor } from '../../../lib/stream';

export const maxDuration = 60;

export async function GET(request: Request) {
  let cursor: string;
  try { cursor = resumeCursor(request); }
  catch { return new Response('Invalid stream cursor', { status: 400 }); }
  try {
    return new Response(openFeedStream(request, cursor), {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch { return new Response('Stream unavailable', { status: 503 }); }
}
