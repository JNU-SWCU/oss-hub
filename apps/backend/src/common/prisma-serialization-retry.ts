import { Prisma } from '@prisma/client';

const SERIALIZATION_FAILURE_CODE = 'P2034';
/** Prisma가 `$queryRaw`/`$executeRaw` 실패를 감쌀 때 쓰는 코드. */
const RAW_QUERY_FAILED_CODE = 'P2010';
/** Postgres `serialization_failure`. `RepeatableRead`·`Serializable`에서만 난다. */
const POSTGRES_SERIALIZATION_FAILURE = '40001';
const DEFAULT_MAX_ATTEMPTS = 3;

function defaultBackoffMs(attempt: number): number {
  return 25 * attempt;
}

/**
 * 직렬화 충돌인가 — **두 모양을 모두** 본다.
 *
 * Prisma 자신의 질의(`user.update` 등)가 낸 충돌은 `P2034`로 온다. 그런데 `$queryRaw`가
 * 낸 충돌은 `P2034`가 아니라 `P2010`(`Raw query failed`)으로 감싸이고 Postgres의 원래
 * 코드(`40001`)는 `meta.code`에 들어간다. `P2034`만 보면 raw `SELECT … FOR UPDATE`가
 * `RepeatableRead` 트랜잭션에서 잠금 경쟁에 졌을 때 **재시도가 걸리지 않고 raw Prisma
 * 에러가 그대로 500으로 새어 나간다**(#822, 실측은 #821).
 *
 * `P2010`은 raw 질의 실패 **전반**이라 `meta.code`가 `40001`일 때만 골라낸다 — 문법
 * 오류나 제약 위반까지 재시도하면 안 된다. `meta`는 Prisma가 `unknown`으로 주므로
 * 좁혀서 읽는다(확인 기준 `@prisma/client` 6.19.3).
 */
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
  /** attempt는 1부터 시작한다(직전 실패가 몇 번째 시도였는지). 테스트에서 0을 주어 지연 없이 검증한다. */
  readonly backoffMs?: (attempt: number) => number;
  /**
   * 재시도를 모두 써도 여전히 직렬화 충돌이면 이 팩토리로 최종 에러를 만든다. 생략하면
   * 마지막 충돌을 그대로 다시 던진다 — 409로의 매핑은 도메인마다 다르므로
   * (`ErrorCode`) 이 공용 계층은 강제하지 않고 호출자가 고른다.
   */
  readonly onExhausted?: (
    lastError: Prisma.PrismaClientKnownRequestError,
  ) => Error;
}

/**
 * Postgres 직렬화 충돌을 흡수한다 — 콜백 전체를 처음부터 다시 실행한다
 * (부분 재시도가 아니라 트랜잭션 전체 재시도). 콜백이 `$transaction`을 감싼
 * 것이라면 재시도마다 새 트랜잭션이 열려 before-스냅샷 재조회부터 다시 돈다.
 *
 * 판정은 `isSerializationFailure`가 하며 Prisma 질의(`P2034`)와 raw 질의
 * (`P2010` + `meta.code === '40001'`) 두 모양을 모두 본다. 직렬화 충돌이 아닌 에러는
 * 재시도 없이 즉시 다시 던진다.
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
