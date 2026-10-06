import { Prisma } from '@prisma/client';

const SERIALIZATION_FAILURE_CODE = 'P2034';

const RAW_QUERY_FAILED_CODE = 'P2010';

const POSTGRES_SERIALIZATION_FAILURE = '40001';
const DEFAULT_MAX_ATTEMPTS = 3;

function defaultBackoffMs(attempt: number): number {
  return 25 * attempt;
}

export function isSerializationFailure(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (error.code === SERIALIZATION_FAILURE_CODE) {
    return true;
  }
  if (error.code !== RAW_QUERY_FAILED_CODE) {
    return false;
  }
  const meta = error.meta as { readonly code?: unknown } | undefined;
  return meta?.code === POSTGRES_SERIALIZATION_FAILURE;
}

export interface SerializationRetryOptions {
  readonly maxAttempts?: number;

  readonly backoffMs?: (attempt: number) => number;

  readonly onExhausted?: (
    lastError: Prisma.PrismaClientKnownRequestError,
  ) => Error;
}

export async function withSerializationRetry<T>(
  run: () => Promise<T>,
  options: SerializationRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? defaultBackoffMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isSerializationFailure(error)) {
        throw error;
      }
      if (attempt >= maxAttempts) {
        throw options.onExhausted ? options.onExhausted(error) : error;
      }
      const delay = backoffMs(attempt);
      if (delay > 0) {
        await sleep(delay);
      }
    }
  }

  throw new Error('withSerializationRetry: unreachable');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
