import 'server-only';

import { backendOrigin } from '../../backend-origin';

let origin: string | undefined;

class ServerApiError extends Error {
  constructor(readonly status: number) {
    super('Public backend request failed');
    this.name = 'ServerApiError';
  }
}

export async function serverApiClient(
  path: string,
  cache: { readonly revalidate: number; readonly tags: readonly string[] },
): Promise<unknown> {
  origin ??= backendOrigin();
  const credential = process.env.ORIGIN_BASIC_AUTH;
  const response = await fetch(`${origin}/api/v1/${path}`, {
    next: { revalidate: cache.revalidate, tags: [...cache.tags] },
    signal: AbortSignal.timeout(2000),
    ...(credential ? { headers: { Authorization: credential } } : {}),
  });
  if (!response.ok) throw new ServerApiError(response.status);
  return response.json();
}
