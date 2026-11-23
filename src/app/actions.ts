'use server';

import { revalidatePath } from 'next/cache';
import { manageSubscriptions } from '@/lib/subscriptions';

type State = { message?: string; error?: string };
export async function subscriptionAction(_previous: State, form: FormData): Promise<State> {
  const mode = form.get('mode');
  if (mode !== 'subscribe' && mode !== 'unsubscribe') return { error: 'Choose subscribe or unsubscribe.' };
  try {
    await manageSubscriptions(mode);
    revalidatePath('/');
    return { message: mode === 'subscribe' ? 'Listening for booked and cancelled appointments.' : 'Unsubscribed. Your received events are kept.' };
  } catch {
    return { error: 'Could not update subscriptions. Check that both sites are public and configured, then try again.' };
  }
}
