import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SequentialRepository } from './sequential.repository';

const SERIALIZATION_FAILURE_CODE = 'P2034';

const RAW_QUERY_FAILED_CODE = 'P2010';

const POSTGRES_SERIALIZATION_FAILURE = '40001';
const DEFAULT_MAX_ATTEMPTS = 3;

function defaultBackoffMs(attempt: number): number {
  return 25 * attempt;
}

@Injectable()
export class PrismaSerializationRetryRepository {
  private readonly sequential = new SequentialRepository();

  isSerializationFailure(
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
    const meta = error.meta as
      | {
          readonly driverAdapterError?: {
            readonly cause?: { readonly originalCode?: unknown };
          };
        }
      | undefined;
    return (
      meta?.driverAdapterError?.cause?.originalCode ===
      POSTGRES_SERIALIZATION_FAILURE
    );
  }

  async withSerializationRetry<T>(
    run: () => Promise<T>,
    options: SerializationRetryOptions = {},
  ): Promise<T> {
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const backoffMs = options.backoffMs ?? defaultBackoffMs;

    let outcome: { readonly value: T } | undefined;
    function* attempts() {
      for (let index = 0; index < maxAttempts; index += 1) yield index;
    }
    for await (const index of this.sequential.items(attempts())) {
      const count = index + 1;
      try {
        outcome = { value: await run() };
        break;
      } catch (error) {
        if (!this.isSerializationFailure(error)) {
          throw error;
        }
        if (count >= maxAttempts) {
          throw options.onExhausted ? options.onExhausted(error) : error;
        }
        const delay = backoffMs(count);
        if (delay > 0) {
          await sleep(delay);
        }
      }
    }
    if (outcome === undefined) {
      throw new Error('Serialization retry ended without a result');
    }
    return outcome.value;
  }
}

export interface SerializationRetryOptions {
  readonly maxAttempts?: number;

  readonly backoffMs?: (attempt: number) => number;

  readonly onExhausted?: (
    lastError: Prisma.PrismaClientKnownRequestError,
  ) => Error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
