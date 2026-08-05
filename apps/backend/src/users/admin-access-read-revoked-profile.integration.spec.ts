/**
 * 회수된 교직원이 관리자 목록·상세에서 어떻게 읽히는가 — 실제 행으로 확인한다(#184).
 *
 * 이 PR은 "회수해도 프로필은 완료다"라는 계약을 세웠고, 그 계약이 본인 화면
 * (`users.repository.ts`)에서만 참이면 계약이 아니다. 관리자 화면은 별도 projection
 * (`ADMIN_ACCESS_USER_SELECT`)으로 읽으므로 그쪽에서도 같은 답이 나오는지 따로 봐야
 * 한다 — 단위 검사는 합성 행을 넘기지만, `select`에 컬럼이 실제로 실려 오는지는
 * DB를 거쳐야만 확인된다.
 *
 * ## 회수 상태를 fixture로 직접 만드는 이유
 *
 * `main`의 회수는 아직 `role`을 비우지 않아(그 전이는 PR2가 가져간다) 회수 API로는
 * 이 상태를 만들 수 없다. `role: null` + `selectedRole: STAFF` + 최신 REVOKED 행을
 * 직접 세우면 이 계약이 회수 구현과 독립적으로 성립한다.
 */
import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  findAdminAccessUserById,
  listAdminAccessUsers,
} from './admin-access-read.repository';
import {
  ADMIN_ACCESS_DEFAULT_DIRECTION,
  ADMIN_ACCESS_DEFAULT_SORT,
} from './domain/admin-access';

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
  // 회수된 교직원 — 학번은 교직원 필수가 아니라 애초에 없다.
  await prisma.user.create({
    data: {
      id: REVOKED_STAFF_ID,
      githubId: 9_184_100_001n,
      nickname: 'synthetic-184-revoked-staff',
      name: '합성 교직원',
      department: '인공지능학부',
      role: null,
      selectedRole: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
    },
  });
  await prisma.roleRequest.createMany({
    data: [
      {
        userId: REVOKED_STAFF_ID,
        status: RoleRequestStatus.APPROVED,
        createdAt: APPROVED_AT,
        decidedAt: APPROVED_AT,
      },
      {
        userId: REVOKED_STAFF_ID,
        status: RoleRequestStatus.REVOKED,
        createdAt: REVOKED_AT,
        decidedAt: REVOKED_AT,
      },
    ],
  });
  // 아무것도 고르지 않은 미배정 사용자 — 같은 프로필 값이지만 근거가 없다.
  await prisma.user.create({
    data: {
      id: UNCHOSEN_ID,
      githubId: 9_184_100_002n,
      nickname: 'synthetic-184-unchosen',
      name: '합성 미배정',
      department: '인공지능학부',
      role: null,
      selectedRole: null,
      accountStatus: AccountStatus.ACTIVE,
    },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

it('상세 조회에서 회수된 교직원의 프로필은 완료로 읽힌다', async () => {
  // When
  const detail = await findAdminAccessUserById(prisma, REVOKED_STAFF_ID);

  // Then: 본인 화면과 같은 답이다.
  expect(detail?.role).toBeNull();
  expect(detail?.profile.studentId).toBeNull();
  expect(detail?.isProfileComplete).toBe(true);
  expect(detail?.profile.isComplete).toBe(true);
  // 승인 대기가 아닌 사람에게 결정 근거가 실리면 안 된다 — `roleRequests`는 PENDING만
  // 골라 오고 이 사람에게는 그 행이 없다.
  expect(detail?.pendingRequest).toBeNull();
});

it('고른 역할이 없는 미배정 사용자는 여전히 학생 기준으로 미완료다', async () => {
  // When
  const detail = await findAdminAccessUserById(prisma, UNCHOSEN_ID);

  // Then: 근거가 하나도 없으면 가장 엄격한 기준으로 본다(fail-closed).
  expect(detail?.isProfileComplete).toBe(false);
});

it('목록 조회도 상세와 같은 완료 판정을 돌려준다', async () => {
  // When: 목록은 상세와 다른 질의(findMany + 정렬 id 목록)를 탄다.
  const page = await listAdminAccessUsers(prisma, {
    page: 1,
    limit: 50,
    query: 'synthetic-184-',
    sort: ADMIN_ACCESS_DEFAULT_SORT,
    direction: ADMIN_ACCESS_DEFAULT_DIRECTION,
  });

  // Then
  const completeById = new Map(
    page.items.map((item) => [item.id, item.isProfileComplete] as const),
  );
  expect(completeById.get(REVOKED_STAFF_ID)).toBe(true);
  expect(completeById.get(UNCHOSEN_ID)).toBe(false);
});

async function cleanup(): Promise<void> {
  await prisma.roleRequest.deleteMany({
    where: { user: { id: { startsWith: prefix } } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}
