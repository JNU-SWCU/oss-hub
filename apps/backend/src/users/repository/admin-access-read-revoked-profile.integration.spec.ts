import {
  AccountStatus,
  AffiliationKind,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { PrismaService } from '../../prisma/prisma.service';
import {
  findAdminAccessUserById,
  listAdminAccessUsers,
} from './admin-access-read.repository';
import {
  ADMIN_ACCESS_DEFAULT_DIRECTION,
  ADMIN_ACCESS_DEFAULT_SORT,
} from '../domain/admin-access';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const prefix = 'test:184:admin-read:';
const REVOKED_STAFF_ID = `${prefix}revoked-staff`;
const UNCHOSEN_ID = `${prefix}unchosen`;
const APPROVED_AT = new Date('2026-02-01T00:00:00.000Z');
const REVOKED_AT = new Date('2026-02-02T00:00:00.000Z');

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();

  await prisma.user.create({
    data: {
      id: REVOKED_STAFF_ID,
      githubId: 9_184_100_001n,
      nickname: 'synthetic-184-revoked-staff',
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: false,
      accountStatus: AccountStatus.ACTIVE,
      profile: {
        create: {
          name: '합성 회수 교직원',
          studentId: null,
          department: '합성 사업단',
          memberKind: MemberKind.STAFF,
          affiliationKind: AffiliationKind.PROGRAM_OFFICE,
          affiliationName: '합성 사업단',
        },
      },
    },
  });
  await prisma.staffAccessRequest.createMany({
    data: [
      {
        userId: REVOKED_STAFF_ID,
        status: StaffAccessRequestStatus.APPROVED,
        createdAt: APPROVED_AT,
        decidedAt: APPROVED_AT,
      },
      {
        userId: REVOKED_STAFF_ID,
        status: StaffAccessRequestStatus.REVOKED,
        createdAt: REVOKED_AT,
        decidedAt: REVOKED_AT,
      },
    ],
  });

  await prisma.user.create({
    data: {
      id: UNCHOSEN_ID,
      githubId: 9_184_100_002n,
      nickname: 'synthetic-184-unchosen',
      selectedMemberKind: null,
      accountStatus: AccountStatus.ACTIVE,
    },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

it('상세 조회에서 회수된 교직원의 프로필은 완료로 읽힌다', async () => {
  const detail = await findAdminAccessUserById(prisma, REVOKED_STAFF_ID);

  expect(detail?.role).toBeNull();
  expect(detail?.profile.studentId).toBeNull();
  expect(detail?.isProfileComplete).toBe(true);
  expect(detail?.profile.isComplete).toBe(true);

  expect(detail?.pendingRequest).toBeNull();
});

it('고른 역할이 없는 미배정 사용자는 여전히 학생 기준으로 미완료다', async () => {
  const detail = await findAdminAccessUserById(prisma, UNCHOSEN_ID);

  expect(detail?.isProfileComplete).toBe(false);
});

it('목록 조회도 상세와 같은 완료 판정을 돌려준다', async () => {
  const page = await listAdminAccessUsers(prisma, {
    page: 1,
    limit: 50,
    query: 'synthetic-184-',
    sort: ADMIN_ACCESS_DEFAULT_SORT,
    direction: ADMIN_ACCESS_DEFAULT_DIRECTION,
  });

  const completeById = new Map(
    page.items.map((item) => [item.id, item.isProfileComplete] as const),
  );
  expect(completeById.get(REVOKED_STAFF_ID)).toBe(true);
  expect(completeById.get(UNCHOSEN_ID)).toBe(false);
});

async function cleanup(): Promise<void> {
  await prisma.staffAccessRequest.deleteMany({
    where: { user: { id: { startsWith: prefix } } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}
