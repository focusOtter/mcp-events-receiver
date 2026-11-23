import { createWebhook } from '../../../lib/webhook';

export const maxDuration = 60;
export async function POST(request: Request) { return createWebhook()(request); }
