import 'server-only';

import { unstable_cache } from 'next/cache';
import { backendOrigin } from '../../backend-origin';

let origin: string | undefined;

const REQUEST_DEADLINE_MS = 2000;

class ServerApiError extends Error {
  constructor(readonly status: number) {
    super('Public backend request failed');
    this.name = 'ServerApiError';
  }
}

class ServerApiTimeoutError extends Error {
  constructor() {
    super('Public backend request timed out');
    this.name = 'ServerApiTimeoutError';
  }
}

async function fetchPublicJson(
  url: string,
  credential: string | undefined,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new ServerApiTimeoutError();
      controller.abort(error);
      reject(error);
    }, REQUEST_DEADLINE_MS);
  });
  const read = (async () => {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      ...(credential ? { headers: { Authorization: credential } } : {}),
    });
    if (!response.ok) throw new ServerApiError(response.status);
    return (await response.json()) as unknown;
  })();
  try {
    return await Promise.race([read, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function serverApiClient(
  path: string,
  cache: { readonly revalidate: number; readonly tags: readonly string[] },
): Promise<unknown> {
  origin ??= backendOrigin();
  const credential = process.env.ORIGIN_BASIC_AUTH;
  const url = `${origin}/api/v1/${path}`;
  return unstable_cache(
    () => fetchPublicJson(url, credential),
    ['server-api', url],
    { revalidate: cache.revalidate, tags: [...cache.tags] },
  )();
}
