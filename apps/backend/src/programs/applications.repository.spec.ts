import { PlatformRepository } from '../platform/platform.repository';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import { TeamHistoryRepository } from './team-history.repository';
import { Prisma, ProgramLifecycle } from '@prisma/client';
import { ApplicationsRepository } from './team.repository';
import type { PrismaService } from '../platform/prisma.service';

type LockQueryMock = jest.Mock<Promise<unknown>, [Prisma.Sql]>;

function buildStoreHarness(overrides: {
  readonly lockedRows: readonly unknown[];
}) {
  const queryRaw: LockQueryMock = jest
    .fn<Promise<unknown>, [Prisma.Sql]>()
    .mockResolvedValue(overrides.lockedRows);
  const transaction = { $queryRaw: queryRaw };
  const prisma = {
    $transaction: (operation: (tx: typeof transaction) => Promise<unknown>) =>
      operation(transaction),
  } as unknown as PrismaService;
  const repository = new ApplicationsRepository(
    prisma,
    new TeamHistoryRepository(),
    new RepositoryProvisionGenerationRepository(),
    new PlatformRepository(),
  );
  return { repository, queryRaw };
}

function lockedSqlOf(queryRaw: LockQueryMock): Prisma.Sql {
  const call = queryRaw.mock.calls[0];
  if (call === undefined) {
    throw new Error('expected a FOR UPDATE query');
  }
  return call[0];
}

describe('PrismaApplicationCreateStore.lockProgramForApply', () => {
  it('프로그램 행을 잠그면서 신청 정책 네 필드를 함께 조회한다', async () => {
    const policy = {
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-07-31T23:59:59.000Z'),
      applicationTemplateVersion: 2,
    };
    const { repository, queryRaw } = buildStoreHarness({
      lockedRows: [policy],
    });

    const result = await repository.withCreateTransaction((store) =>
      store.lockProgramForApply('synthetic-program'),
    );

    expect(result).toEqual(policy);
    const sql = lockedSqlOf(queryRaw);
    expect(sql.values).toEqual(['synthetic-program']);
  });

  it('잠글 프로그램이 없으면 null을 반환한다', async () => {
    const { repository } = buildStoreHarness({ lockedRows: [] });
    await expect(
      repository.withCreateTransaction((store) =>
        store.lockProgramForApply('synthetic-missing-program'),
      ),
    ).resolves.toBeNull();
  });
});
