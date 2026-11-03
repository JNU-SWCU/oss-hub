import {
  AccountStatus,
  type UserType,
  type ApprovalStatus,
} from '@prisma/client';
import type { PrismaService } from '../platform/prisma.service';
import { RankingRepository } from './ranking.repository';

type Actor = {
  type: UserType;
  approvalStatus: ApprovalStatus;
  profileCreatedAt: Date | null;
  name: string | null;
  department: string | null;
  admin: { userId: string } | null;
  accountStatus: AccountStatus;
} | null;

function repositoryWithActor(actor: Actor): RankingRepository {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(actor) },
  } as unknown as PrismaService;
  return new RankingRepository(prisma);
}

const member = {
  type: 'STUDENT',
  approvalStatus: 'NOT_REQUIRED',
  profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
  name: 'Synthetic member',
  department: 'Synthetic department',
  admin: null,
  accountStatus: AccountStatus.ACTIVE,
} satisfies NonNullable<Actor>;

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

  it.each([
    [
      'approved staff',
      { ...member, type: 'STAFF', approvalStatus: 'APPROVED' },
      'staff',
    ],
    ['student admin', { ...member, admin: { userId: 'admin-1' } }, 'member'],
    [
      'pending staff admin',
      {
        ...member,
        type: 'STAFF',
        approvalStatus: 'PENDING',
        admin: { userId: 'admin-1' },
      },
      'member',
    ],
    [
      'incomplete approved staff',
      {
        ...member,
        type: 'STAFF',
        approvalStatus: 'APPROVED',
        profileCreatedAt: null,
      },
      'member',
    ],
  ] satisfies readonly (readonly [string, NonNullable<Actor>, string])[])(
    '%s has the correct private-data audience',
    async (_label, actor, expected) => {
      await expect(
        repositoryWithActor(actor).findViewerClass(1n),
      ).resolves.toBe(expected);
    },
  );

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
          type: 'STAFF',
          approvalStatus: 'APPROVED',
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
