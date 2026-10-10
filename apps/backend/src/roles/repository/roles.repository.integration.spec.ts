import {
  AffiliationKind,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import type { ConsentsService } from '../../consents/service/consents.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersOnboardingRepository } from '../../users/repository/onboarding.repository';
import { RolesErrorCode } from '../../users/domain/roles-error-code.enum';
import { RolesService } from '../service/roles.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:169:';
const STAFF_GITHUB_ID = 9_169_000_001n;
const MIXED_GITHUB_ID = 9_169_000_002n;
const INCOMPLETE_GITHUB_ID = 9_169_000_003n;
const STAFF_PROFILE = {
  name: '합성 교직원',
  studentId: null,
  department: '인공지능학부',
  memberKind: MemberKind.STAFF,
  affiliationKind: AffiliationKind.PROGRAM_OFFICE,
  affiliationName: '인공지능학부',
} as const;

describe('UsersOnboardingRepository integration', () => {
  const prisma = new PrismaService();
  const repository = new UsersOnboardingRepository(prisma);
  const consentsService: Pick<ConsentsService, 'requireCurrent'> = {
    requireCurrent: jest.fn().mockResolvedValue(undefined),
  };
  const service = new RolesService(repository, consentsService);

  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await prisma.staffAccessRequest.deleteMany({
      where: { user: { id: { startsWith: TEST_PREFIX } } },
    });
    await prisma.user.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
  });

  afterAll(async () => {
    await prisma.staffAccessRequest.deleteMany({
      where: { user: { id: { startsWith: TEST_PREFIX } } },
    });
    await prisma.user.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.$disconnect();
  });

  it('동시 교직원 선택은 한 PENDING 요청으로 수렴한다', async () => {
    const user = await prisma.user.create({
      data: {
        id: `${TEST_PREFIX}staff`,
        githubId: STAFF_GITHUB_ID,
        nickname: 'synthetic-169-staff',
        selectedMemberKind: MemberKind.STAFF,
        hasStaffAccess: false,
        hasAdminAccess: false,
        profile: { create: STAFF_PROFILE },
      },
    });

    const results = await Promise.all([
      service.selectMemberKind(STAFF_GITHUB_ID, 'STAFF'),
      service.selectMemberKind(STAFF_GITHUB_ID, 'STAFF'),
    ]);

    const pendingCount = await prisma.staffAccessRequest.count({
      where: { userId: user.id, status: StaffAccessRequestStatus.PENDING },
    });
    expect(results).toHaveLength(2);
    expect(
      results.every((result) => result.selectedMemberKind === 'STAFF'),
    ).toBe(true);
    expect(pendingCount).toBe(1);
  });

  it('동시 학생·교직원 선택은 프로필이 없으면 아무것도 확정하지 않는다', async () => {
    const user = await prisma.user.create({
      data: {
        id: `${TEST_PREFIX}mixed`,
        githubId: MIXED_GITHUB_ID,
        nickname: 'synthetic-169-mixed',
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
    });

    const results = await Promise.allSettled([
      service.selectMemberKind(MIXED_GITHUB_ID, 'STUDENT'),
      service.selectMemberKind(MIXED_GITHUB_ID, 'STAFF'),
    ]);

    const [storedUser, requestCount, profile] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      prisma.staffAccessRequest.count({
        where: { userId: user.id },
      }),
      prisma.userProfile.findUnique({ where: { userId: user.id } }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(2);
    expect(
      storedUser.selectedMemberKind === MemberKind.STUDENT ||
        storedUser.selectedMemberKind === MemberKind.STAFF,
    ).toBe(true);
    expect(storedUser.hasStaffAccess).toBe(false);
    expect(storedUser.hasAdminAccess).toBe(false);
    expect(requestCount).toBe(0);
    expect(profile).toBeNull();
  });

  it.each<MemberKind>(['STUDENT', 'STAFF'])(
    '프로필이 비어 있으면 %s 선택은 기록만 남기고 아무것도 확정하지 않는다',
    async (selectedMemberKind) => {
      const user = await prisma.user.create({
        data: {
          id: `${TEST_PREFIX}incomplete-${selectedMemberKind.toLowerCase()}`,
          githubId:
            INCOMPLETE_GITHUB_ID + (selectedMemberKind === 'STUDENT' ? 0n : 1n),
          nickname: `synthetic-169-incomplete-${selectedMemberKind.toLowerCase()}`,
          hasStaffAccess: false,
          hasAdminAccess: false,
        },
      });

      const result = await service.selectMemberKind(
        user.githubId,
        selectedMemberKind,
      );

      expect(result).toEqual({
        selectedMemberKind,
        redirectTo: '/onboarding/profile',
      });
      const [storedUser, requestCount, profile] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
        prisma.staffAccessRequest.count({ where: { userId: user.id } }),
        prisma.userProfile.findUnique({ where: { userId: user.id } }),
      ]);
      expect(storedUser.selectedMemberKind).toBe(selectedMemberKind);
      expect(storedUser.hasStaffAccess).toBe(false);
      expect(storedUser.hasAdminAccess).toBe(false);
      expect(requestCount).toBe(0);
      expect(profile).toBeNull();
    },
  );

  describe('회수된 사용자의 재선택·재요청 (#184)', () => {
    const REVOKED_AT = new Date('2026-02-02T00:00:00.000Z');
    const APPROVED_AT = new Date('2026-02-01T00:00:00.000Z');

    async function createRevokedStaff(
      key: string,
      githubId: bigint,
      access: {
        readonly hasStaffAccess?: boolean;
        readonly hasAdminAccess?: boolean;
      } = {},
    ) {
      const user = await prisma.user.create({
        data: {
          id: `${TEST_PREFIX}${key}`,
          githubId,
          nickname: `synthetic-184-${key}`,
          selectedMemberKind: MemberKind.STAFF,
          hasStaffAccess: access.hasStaffAccess ?? false,
          hasAdminAccess: access.hasAdminAccess ?? false,
          profile: { create: STAFF_PROFILE },
        },
      });
      await prisma.staffAccessRequest.create({
        data: {
          userId: user.id,
          status: StaffAccessRequestStatus.APPROVED,
          createdAt: APPROVED_AT,
          decidedAt: APPROVED_AT,
        },
      });
      await prisma.staffAccessRequest.create({
        data: {
          userId: user.id,
          status: StaffAccessRequestStatus.REVOKED,
          createdAt: REVOKED_AT,
          decidedAt: REVOKED_AT,
        },
      });
      return user;
    }

    it('회수돼 접근이 없어도 확정된 회원 유형은 바꿀 수 없다', async () => {
      const user = await createRevokedStaff('revoked-student', 9_184_000_001n);

      const promise = service.selectMemberKind(user.githubId, 'STUDENT');

      await expect(promise).rejects.toMatchObject({
        errorCode: { code: RolesErrorCode.ROLE_ALREADY_CONFIRMED },
      });
      const [stored, requestCount, profile] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
        prisma.staffAccessRequest.count({ where: { userId: user.id } }),
        prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } }),
      ]);
      expect(stored.selectedMemberKind).toBe(MemberKind.STAFF);
      expect(stored.hasStaffAccess).toBe(false);
      expect(stored.hasAdminAccess).toBe(false);
      expect(profile.memberKind).toBe(MemberKind.STAFF);
      expect(requestCount).toBe(2);
    });

    it('교직원을 다시 고르면 그 자리에서 신청 한 건이 만들어진다', async () => {
      const user = await createRevokedStaff('revoked-staff', 9_184_000_002n);

      const result = await service.selectMemberKind(user.githubId, 'STAFF');

      const [stored, pendingCount, requestCount] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
        prisma.staffAccessRequest.count({
          where: { userId: user.id, status: StaffAccessRequestStatus.PENDING },
        }),
        prisma.staffAccessRequest.count({ where: { userId: user.id } }),
      ]);
      expect(result.selectedMemberKind).toBe('STAFF');
      expect(stored.hasStaffAccess).toBe(false);
      expect(stored.hasAdminAccess).toBe(false);
      expect(pendingCount).toBe(1);
      expect(requestCount).toBe(3);
    });

    it('교직원을 두 번 골라도 신청은 한 건이다', async () => {
      const user = await createRevokedStaff('revoked-twice', 9_184_000_006n);

      await service.selectMemberKind(user.githubId, 'STAFF');
      await service.selectMemberKind(user.githubId, 'STAFF');

      const pendingCount = await prisma.staffAccessRequest.count({
        where: { userId: user.id, status: StaffAccessRequestStatus.PENDING },
      });
      expect(pendingCount).toBe(1);
    });

    it('교직원을 재요청하면 새 PENDING 행이 생기고 승인 이력은 남는다', async () => {
      const user = await createRevokedStaff('revoked-retry', 9_184_000_003n);

      const result = await service.retryStaffRequest(user.githubId);

      const [stored, requests] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
        prisma.staffAccessRequest.findMany({
          where: { userId: user.id },
          orderBy: [{ createdAt: 'asc' }],
        }),
      ]);
      expect(result.status).toBe(StaffAccessRequestStatus.PENDING);

      expect(result.status).not.toMatch(/APPROVED|REVOKED/);
      expect(requests).toHaveLength(3);
      expect(requests[0]?.status).toBe(StaffAccessRequestStatus.APPROVED);
      expect(requests[1]?.status).toBe(StaffAccessRequestStatus.REVOKED);
      expect(requests[2]?.status).toBe(StaffAccessRequestStatus.PENDING);

      expect(stored.hasStaffAccess).toBe(false);
      expect(stored.hasAdminAccess).toBe(false);
      expect(stored.selectedMemberKind).toBe('STAFF');
    });

    it('동시 재요청 2건은 한 PENDING으로 수렴한다', async () => {
      const user = await createRevokedStaff('revoked-race', 9_184_000_004n);

      const results = await Promise.allSettled([
        service.retryStaffRequest(user.githubId),
        service.retryStaffRequest(user.githubId),
      ]);

      const pendingCount = await prisma.staffAccessRequest.count({
        where: { userId: user.id, status: StaffAccessRequestStatus.PENDING },
      });
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(pendingCount).toBe(1);
    });

    it('회수 이력이 있어도 유형이 확정된 사용자는 다시 고를 수 없다', async () => {
      const user = await createRevokedStaff(
        'reapproved-staff',
        9_184_000_005n,
        { hasStaffAccess: true },
      );

      const promise = service.selectMemberKind(user.githubId, 'STUDENT');

      await expect(promise).rejects.toMatchObject({
        errorCode: { code: RolesErrorCode.ROLE_ALREADY_CONFIRMED },
      });
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(stored.hasStaffAccess).toBe(true);
      expect(stored.hasAdminAccess).toBe(false);
      expect(stored.selectedMemberKind).toBe('STAFF');
    });
  });
});
