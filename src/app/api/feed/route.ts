import { readFeed } from '@/lib/events';

export async function GET() {
  try { return Response.json(await readFeed(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'The feed is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
