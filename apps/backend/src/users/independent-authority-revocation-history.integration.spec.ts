import { AccountStatus, StaffAccessRequestStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { ConsentsService } from '../consents/consents.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesRepository } from '../roles/roles.repository';
import { RolesService } from '../roles/roles.service';
import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import { STAFF_ACCESS_COMMANDS } from './domain/independent-authority';
import { IndependentAuthorityRepository } from './independent-authority.repository';
import { IndependentAuthorityService } from './independent-authority.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const authority = new IndependentAuthorityService(
  new IndependentAuthorityRepository(prisma),
  new AuditLogService(new AuditLogRepository(prisma)),
);
// 동의는 이 시나리오와 무관한 선행 조건이라 통과시킨다 — 회수 뒤 재신청이 열리는지만 본다.
const consentsService: Pick<ConsentsService, 'requireCurrent'> = {
  requireCurrent: jest.fn().mockResolvedValue(undefined),
};
const roles = new RolesService(new RolesRepository(prisma), consentsService);

const TEST_PREFIX = 'test:1383:independent-authority-revocation:';
const GITHUB_ID_BASE = 9_013_830_000n;
let sequence = 0;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

it('화면이 쓰는 회수 API는 REVOKED 행을 남겨 당사자를 역할 선택으로 되돌린다', async () => {
  // Given — 승인받아 교직원이 된 사람. 회수 전에는 마지막 신청이 APPROVED다.
  const actor = await createUser('recovery-actor', 'ADMIN');
  const target = await createUser('recovery-target', 'STAFF');
  const approved = await prisma.staffAccessRequest.create({
    data: {
      userId: target.id,
      status: StaffAccessRequestStatus.APPROVED,
      decidedById: actor.id,
      decidedAt: new Date('2026-08-01T00:00:00.000Z'),
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  });

  // When — 「교직원 접근 해제」 버튼이 보내는 명령 그대로다.
  await authority.patchStaffAccess(actor.githubId, target.id, {
    command: STAFF_ACCESS_COMMANDS.REVOKE,
  });

  // Then — 권한이 꺼지고, 옛 CAS 경로와 같은 모양의 회수 행이 한 줄 남는다.
  await expect(
    prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
  ).resolves.toMatchObject({ hasStaffAccess: false });
  const requests = await prisma.staffAccessRequest.findMany({
    where: { userId: target.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({
    id: approved.id,
    status: StaffAccessRequestStatus.APPROVED,
  });
  expect(requests[1]).toMatchObject({
    status: StaffAccessRequestStatus.REVOKED,
    decidedById: actor.id,
    rejectionReason: null,
  });
  expect(requests[1]?.decidedAt).not.toBeNull();

  // 같은 회수를 한 번 더 보내도 이력은 한 줄만 늘어난 채로 있다.
  await authority.patchStaffAccess(actor.githubId, target.id, {
    command: STAFF_ACCESS_COMMANDS.REVOKE,
  });
  await expect(
    prisma.staffAccessRequest.count({
      where: { userId: target.id, status: StaffAccessRequestStatus.REVOKED },
    }),
  ).resolves.toBe(1);

  // 당사자가 다시 로그인했을 때 보는 것 — `GET /api/v1/role-requests/me`.
  await expect(roles.getMyRequest(target.githubId)).resolves.toMatchObject({
    status: StaffAccessRequestStatus.REVOKED,
  });

  // 다시 교직원으로 신청하는 문 — `POST /api/v1/role-requests`. 회수 행이 없으면
  // 마지막 신청이 APPROVED로 읽혀 여기서 409(ROL_002)가 난다.
  await expect(roles.retryStaffRequest(target.githubId)).resolves.toMatchObject(
    { status: StaffAccessRequestStatus.PENDING },
  );
});

function createUser(label: string, role: 'STAFF' | 'ADMIN') {
  sequence += 1;
  return prisma.user.create({
    data: canonicalUserCreateFromLabel(role, {
      id: `${TEST_PREFIX}${label}:${sequence}`,
      githubId: GITHUB_ID_BASE + BigInt(sequence),
      nickname: `synthetic-1383-${label}-${sequence}`,
      accountStatus: AccountStatus.ACTIVE,
    }),
    select: { id: true, githubId: true },
  });
}
