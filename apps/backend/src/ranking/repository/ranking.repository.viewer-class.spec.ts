import { AccountStatus } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { RankingRepository } from './ranking.repository';

type Actor = {
  hasStaffAccess: boolean;
  hasAdminAccess: boolean;
  accountStatus: AccountStatus;
} | null;

function repositoryWithActor(actor: Actor): RankingRepository {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(actor) },
  } as unknown as PrismaService;
  return new RankingRepository(prisma);
}

const member = {
  hasStaffAccess: false,
  hasAdminAccess: false,
  accountStatus: AccountStatus.ACTIVE,
};

describe('RankingRepository.findViewerClass', () => {
  it('세션이 없으면 public 이다', async () => {
    await expect(
      repositoryWithActor(member).findViewerClass(null),
    ).resolves.toBe('public');
  });

  it('ACTIVE 일반 사용자는 member 다', async () => {
    await expect(repositoryWithActor(member).findViewerClass(1n)).resolves.toBe(
      'member',
    );
  });

  it('ACTIVE staff·admin 은 staff 다', async () => {
    await expect(
      repositoryWithActor({ ...member, hasStaffAccess: true }).findViewerClass(
        1n,
      ),
    ).resolves.toBe('staff');
    await expect(
      repositoryWithActor({ ...member, hasAdminAccess: true }).findViewerClass(
        1n,
      ),
    ).resolves.toBe('staff');
  });

  it('ACTIVE 가 아니면 권한이 있어도 public 으로 떨어진다', async () => {
    for (const accountStatus of Object.values(AccountStatus).filter(
      (status) => status !== AccountStatus.ACTIVE,
    )) {
      await expect(
        repositoryWithActor({ ...member, accountStatus }).findViewerClass(1n),
      ).resolves.toBe('public');
      await expect(
        repositoryWithActor({
          ...member,
          hasStaffAccess: true,
          accountStatus,
        }).findViewerClass(1n),
      ).resolves.toBe('public');
    }
  });

  it('githubId 는 있으나 user 레코드가 없으면 public 이다', async () => {
    await expect(repositoryWithActor(null).findViewerClass(1n)).resolves.toBe(
      'public',
    );
  });
});
