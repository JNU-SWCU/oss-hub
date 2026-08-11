import { Prisma } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { AdminProfileRepository } from './admin-profile.repository';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.enum';

function serializationFailure(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'could not serialize access due to concurrent update',
    { code: 'P2034', clientVersion: 'test' },
  );
}

describe('AdminProfileRepository.withTransaction', () => {
  it('P2034로 한 번 실패한 뒤 재시도에서 성공하면 콜백을 새 트랜잭션으로 다시 실행한 결과를 돌려준다', async () => {
    // Given
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(serializationFailure())
      .mockImplementationOnce((fn: (tx: unknown) => unknown) => fn({}));
    const prisma = { $transaction: transaction };
    const repository = new AdminProfileRepository(
      prisma as unknown as PrismaService,
    );
    const operation = jest.fn().mockResolvedValue('result');

    // When
    const result = await repository.withTransaction(operation);

    // Then — before-스냅샷 재조회를 포함한 콜백 전체가 새 트랜잭션에서 다시 돈다.
    expect(result).toBe('result');
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('P2034 재시도를 모두 소진하면 원시 Prisma 에러 대신 409 PROFILE_UPDATE_CONFLICT를 던진다', async () => {
    // Given
    const transaction = jest.fn().mockRejectedValue(serializationFailure());
    const prisma = { $transaction: transaction };
    const repository = new AdminProfileRepository(
      prisma as unknown as PrismaService,
    );

    // When / Then
    const rejection = repository.withTransaction(() =>
      Promise.resolve('unused'),
    );
    await expect(rejection).rejects.toBeInstanceOf(DomainException);
    await expect(rejection).rejects.toMatchObject({
      errorCode: USERS_ERROR_CODES[UsersErrorCode.PROFILE_UPDATE_CONFLICT],
    });
    // 원시 Prisma 에러는 호출자에게 새어 나가지 않는다.
    await expect(rejection).rejects.not.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('P2034가 아닌 에러는 재시도 없이 그대로 다시 던진다', async () => {
    // Given
    const notFound = new Prisma.PrismaClientKnownRequestError(
      'unique constraint failed',
      { code: 'P2002', clientVersion: 'test' },
    );
    const transaction = jest.fn().mockRejectedValue(notFound);
    const prisma = { $transaction: transaction };
    const repository = new AdminProfileRepository(
      prisma as unknown as PrismaService,
    );

    // When / Then
    await expect(
      repository.withTransaction(() => Promise.resolve('unused')),
    ).rejects.toBe(notFound);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
