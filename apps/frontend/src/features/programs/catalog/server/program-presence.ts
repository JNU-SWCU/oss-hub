import 'server-only';

import { ServerApiError, serverApiClient } from '@/lib/server-api-client';

const PRESENCE_REVALIDATE_SECONDS = 60;

export async function isProgramMissing(programId: string): Promise<boolean> {
  try {
    await serverApiClient(`programs/${encodeURIComponent(programId)}`, {
      revalidate: PRESENCE_REVALIDATE_SECONDS,
      tags: ['programs'],
    });
    return false;
  } catch (error: unknown) {
    if (error instanceof ServerApiError && error.status === 404) return true;
    console.warn('program.presence.unavailable', {
      error: error instanceof Error ? error.name : 'UnknownError',
      status: error instanceof ServerApiError ? error.status : undefined,
    });
    return false;
  }
}
