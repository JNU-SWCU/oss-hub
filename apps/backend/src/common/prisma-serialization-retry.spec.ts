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
});
