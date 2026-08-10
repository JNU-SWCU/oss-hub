import { Prisma } from '@prisma/client';

const SERIALIZATION_FAILURE_CODE = 'P2034';
const DEFAULT_MAX_ATTEMPTS = 3;

function defaultBackoffMs(attempt: number): number {
  return 25 * attempt;
}

export function isSerializationFailure(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === SERIALIZATION_FAILURE_CODE
  );
}

export interface SerializationRetryOptions {
  readonly maxAttempts?: number;
  /** attempt는 1부터 시작한다(직전 실패가 몇 번째 시도였는지). 테스트에서 0을 주어 지연 없이 검증한다. */
  readonly backoffMs?: (attempt: number) => number;
  /**
   * 재시도를 모두 써도 여전히 P2034면 이 팩토리로 최종 에러를 만든다. 생략하면
   * 마지막 P2034를 그대로 다시 던진다 — 409로의 매핑은 도메인마다 다르므로
   * (`ErrorCode`) 이 공용 계층은 강제하지 않고 호출자가 고른다.
   */
  readonly onExhausted?: (
    lastError: Prisma.PrismaClientKnownRequestError,
  ) => Error;
}

/**
 * Postgres 직렬화 충돌(P2034)을 흡수한다 — 콜백 전체를 처음부터 다시 실행한다
 * (부분 재시도가 아니라 트랜잭션 전체 재시도). 콜백이 `$transaction`을 감싼
 * 것이라면 재시도마다 새 트랜잭션이 열려 before-스냅샷 재조회부터 다시 돈다.
 *
 * P2034가 아닌 에러는 재시도 없이 즉시 다시 던진다.
 */
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
  // maxAttempts가 1 이상인 한 위 루프가 항상 return/throw로 끝난다.
  throw new Error('withSerializationRetry: unreachable');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
