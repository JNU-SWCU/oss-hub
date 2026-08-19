import { AccountStatus, Role } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { RANKING_VIEWER_TIERS } from '../domain/ranking';
import { RankingViewerRepository } from './ranking-viewer.repository';

interface FindUniqueArgs {
  where: { githubId: bigint };
  select: Record<string, unknown>;
}

const createDb = (): {
  user: { findUnique: jest.Mock<Promise<unknown>, [FindUniqueArgs]> };
} => {
  const findUnique = jest.fn<Promise<unknown>, [FindUniqueArgs]>();
  findUnique.mockResolvedValue(null);
  return { user: { findUnique } };
};

const repositoryFor = (db: ReturnType<typeof createDb>) =>
  new RankingViewerRepository(db as unknown as PrismaService);

describe('RankingViewerRepository — 랭킹 계층 판정', () => {
  it('세션이 없으면 조회 자체를 하지 않고 공개 계층이다', async () => {
    const db = createDb();

    await expect(repositoryFor(db).findTier(null)).resolves.toBe(
      RANKING_VIEWER_TIERS.PUBLIC,
    );
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('계층 판정에 필요한 칸만 읽는다 — 실명·학번은 select 에 없다', async () => {
    const db = createDb();

    await repositoryFor(db).findTier(42n);

    const args = db.user.findUnique.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ githubId: 42n });
    expect(Object.keys(args?.select ?? {}).sort()).toEqual([
      'accountStatus',
      'role',
    ]);
  });

  it.each([
    [Role.STAFF, RANKING_VIEWER_TIERS.STAFF],
    [Role.ADMIN, RANKING_VIEWER_TIERS.STAFF],
    [Role.STUDENT, RANKING_VIEWER_TIERS.PUBLIC],
  ])('ACTIVE %s 는 %s 계층이다', async (role, expected) => {
    const db = createDb();
    db.user.findUnique.mockResolvedValue({
      role,
      accountStatus: AccountStatus.ACTIVE,
    });

    await expect(repositoryFor(db).findTier(1n)).resolves.toBe(expected);
  });

  it('역할이 아직 없는 가입 진행자는 공개 계층이다', async () => {
    const db = createDb();
    db.user.findUnique.mockResolvedValue({
      role: null,
      accountStatus: AccountStatus.ACTIVE,
    });

    await expect(repositoryFor(db).findTier(1n)).resolves.toBe(
      RANKING_VIEWER_TIERS.PUBLIC,
    );
  });

  it('비활성 계정은 STAFF 여도 실명을 볼 자격을 잃는다', async () => {
    const db = createDb();
    db.user.findUnique.mockResolvedValue({
      role: Role.STAFF,
      accountStatus: AccountStatus.DEACTIVATED,
    });

    await expect(repositoryFor(db).findTier(1n)).resolves.toBe(
      RANKING_VIEWER_TIERS.PUBLIC,
    );
  });

  it('세션 githubId 에 해당하는 User 가 없으면 공개 계층이다 — 예외를 던지지 않는다', async () => {
    const db = createDb();
    db.user.findUnique.mockResolvedValue(null);

    await expect(repositoryFor(db).findTier(9_999n)).resolves.toBe(
      RANKING_VIEWER_TIERS.PUBLIC,
    );
  });
});
