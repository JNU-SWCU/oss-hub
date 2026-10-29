import 'server-only';

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

async function withinDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ServerApiTimeoutError()),
      REQUEST_DEADLINE_MS,
    );
  });
  try {
    return await Promise.race([work, deadline]);
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
  return withinDeadline(
    (async () => {
      const response = await fetch(url, {
        next: { revalidate: cache.revalidate, tags: [...cache.tags] },
        signal: AbortSignal.timeout(REQUEST_DEADLINE_MS),
        ...(credential ? { headers: { Authorization: credential } } : {}),
      });
      if (!response.ok) throw new ServerApiError(response.status);
      return (await response.json()) as unknown;
    })(),
  );
}
