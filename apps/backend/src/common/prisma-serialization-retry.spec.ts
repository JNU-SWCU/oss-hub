import { Prisma } from '@prisma/client';
import { DomainException } from './error-code';
import { withSerializationRetry } from './prisma-serialization-retry';

function serializationFailure(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'could not serialize access due to concurrent update',
    { code: 'P2034', clientVersion: 'test' },
  );
}

function otherFailure(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

/**
 * `$queryRaw`가 낸 직렬화 충돌의 실제 모양이다 — #821에서 실측했다. Prisma는 raw 질의
 * 실패를 `P2010`으로 감싸고 Postgres의 원래 코드를 `meta.code`에 넣는다.
 */
function rawSerializationFailure(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Raw query failed. Code: `40001`. Message: `could not serialize access due to concurrent update`',
    {
      code: 'P2010',
      clientVersion: 'test',
      meta: {
        code: '40001',
        message: 'could not serialize access due to concurrent update',
      },
    },
  );
}

/** 같은 `P2010`이지만 직렬화 충돌이 아니다 — 이건 재시도하면 안 된다. */
function rawSyntaxFailure(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Raw query failed. Code: `42601`. Message: `syntax error at or near "SELCT"`',
    {
      code: 'P2010',
      clientVersion: 'test',
      meta: { code: '42601', message: 'syntax error at or near "SELCT"' },
    },
  );
}

const NO_DELAY = () => 0;

describe('withSerializationRetry', () => {
  it('P2034로 실패한 뒤 재시도에서 성공하면 콜백 전체를 다시 실행한 결과를 돌려준다', async () => {
    // Given
    const run = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(serializationFailure())
      .mockResolvedValueOnce('applied');

    // When
    const result = await withSerializationRetry(run, {
      maxAttempts: 3,
      backoffMs: NO_DELAY,
    });

    // Then
    expect(result).toBe('applied');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('P2034가 아닌 에러는 재시도 없이 즉시 다시 던진다', async () => {
    // Given
    const error = otherFailure();
    const run = jest.fn<Promise<string>, []>().mockRejectedValue(error);

    // When / Then
    await expect(
      withSerializationRetry(run, { maxAttempts: 3, backoffMs: NO_DELAY }),
    ).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('재시도를 모두 소진해도 P2034면 onExhausted가 만든 에러를 던진다', async () => {
    // Given
    const run = jest
      .fn<Promise<string>, []>()
      .mockRejectedValue(serializationFailure());
    const conflict = new DomainException({
      code: 'TEST_CONFLICT',
      status: 409,
      message: '합성 충돌 — 다시 시도해 주세요.',
    });

    // When / Then
    await expect(
      withSerializationRetry(run, {
        maxAttempts: 3,
        backoffMs: NO_DELAY,
        onExhausted: () => conflict,
      }),
    ).rejects.toBe(conflict);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('onExhausted를 주지 않으면 마지막 P2034를 그대로 다시 던진다', async () => {
    // Given
    const error = serializationFailure();
    const run = jest.fn<Promise<string>, []>().mockRejectedValue(error);

    // When / Then
    await expect(
      withSerializationRetry(run, { maxAttempts: 2, backoffMs: NO_DELAY }),
    ).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('raw 질의가 낸 40001(P2010)도 직렬화 충돌로 보고 재시도한다', async () => {
    // Given — raw `SELECT … FOR UPDATE`가 RepeatableRead에서 잠금 경쟁에 진 모양이다.
    // P2034만 보던 시절에는 여기서 재시도가 걸리지 않고 raw 에러가 500으로 새어 나갔다.
    const run = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(rawSerializationFailure())
      .mockResolvedValue('applied');

    // When
    const result = await withSerializationRetry(run, {
      maxAttempts: 3,
      backoffMs: NO_DELAY,
    });

    // Then
    expect(result).toBe('applied');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('40001이 아닌 P2010은 재시도하지 않는다 — raw 실패 전반을 삼키면 안 된다', async () => {
    // Given
    const error = rawSyntaxFailure();
    const run = jest.fn<Promise<string>, []>().mockRejectedValue(error);

    // When / Then
    await expect(
      withSerializationRetry(run, { maxAttempts: 3, backoffMs: NO_DELAY }),
    ).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('meta가 없는 P2010도 재시도하지 않는다', async () => {
    // Given — meta를 좁혀 읽는 코드가 undefined에서 터지지 않는지까지 본다.
    const error = new Prisma.PrismaClientKnownRequestError('raw query failed', {
      code: 'P2010',
      clientVersion: 'test',
    });
    const run = jest.fn<Promise<string>, []>().mockRejectedValue(error);

    // When / Then
    await expect(
      withSerializationRetry(run, { maxAttempts: 3, backoffMs: NO_DELAY }),
    ).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
