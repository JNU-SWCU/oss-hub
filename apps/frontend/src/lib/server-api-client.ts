import 'server-only';

import { unstable_cache } from 'next/cache';
import { backendOrigin, originAuthorization } from '../../backend-origin';
import { apiPath } from './api-client';

let target: PublicApiTarget | undefined;

const VERCEL_HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;

interface PublicApiTarget {
  readonly origin: string;
  readonly sendsCredential: boolean;
}

function publicApiTarget(): PublicApiTarget {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim().toLowerCase();
  if (
    process.env.VERCEL_ENV === 'production' &&
    host &&
    VERCEL_HOST.test(host)
  ) {
    return { origin: `https://${host}`, sendsCredential: false };
  }
  return { origin: backendOrigin(), sendsCredential: true };
}

const REQUEST_DEADLINE_MS = 2000;
const COVER_DEADLINE_MS = 5000;

export class ServerApiError extends Error {
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
  target ??= publicApiTarget();
  const credential = target.sendsCredential
    ? process.env.ORIGIN_BASIC_AUTH
    : undefined;
  const url = `${target.origin}/api/v1/${path}`;
  return unstable_cache(
    () => fetchPublicJson(url, credential),
    ['server-api', url],
    { revalidate: cache.revalidate, tags: [...cache.tags] },
  )();
}

export async function fetchProgramCover(programId: string, coverId: string) {
  let stage:
    | 'origin_authorization'
    | 'origin_validation'
    | 'origin_hash_read'
    | 'fetch_transport' = 'origin_authorization';
  try {
    const credential = originAuthorization();
    stage = 'origin_validation';
    const url = `${backendOrigin()}${apiPath(`/programs/${programId}/cover/${coverId}`)}`;
    stage = 'fetch_transport';
    return await fetch(url, {
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(COVER_DEADLINE_MS),
      ...(credential ? { headers: { Authorization: credential } } : {}),
    });
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause
        : error;
    const code = cause instanceof Error && 'code' in cause ? cause.code : null;
    if (
      stage === 'origin_validation' &&
      cause instanceof Error &&
      'syscall' in cause &&
      (cause.syscall === 'open' || cause.syscall === 'read')
    ) {
      stage = 'origin_hash_read';
    }
    const errorCode =
      error instanceof DOMException &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
        ? error.name
        : code === 'ENOENT' ||
            code === 'EACCES' ||
            code === 'ENOTFOUND' ||
            code === 'EAI_AGAIN' ||
            code === 'ECONNRESET' ||
            code === 'ECONNREFUSED' ||
            code === 'ETIMEDOUT' ||
            code === 'UND_ERR_CONNECT_TIMEOUT'
          ? code
          : undefined;
    console.warn('program.cover_source.failed', { stage, errorCode });
    throw error;
  }
}
