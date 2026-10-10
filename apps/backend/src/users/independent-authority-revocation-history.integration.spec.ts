import { AccountStatus, StaffAccessRequestStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/repository/audit-log.repository';
import { AuditLogService } from '../audit-log/service/audit-log.service';
import type { ConsentsService } from '../consents/service/consents.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersOnboardingRepository } from './repository/onboarding.repository';
import { RolesService } from '../roles/service/roles.service';
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

const consentsService: Pick<ConsentsService, 'requireCurrent'> = {
  requireCurrent: jest.fn().mockResolvedValue(undefined),
};
const roles = new RolesService(
  new UsersOnboardingRepository(prisma),
  consentsService,
);

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

  await authority.patchStaffAccess(actor.githubId, target.id, {
    command: STAFF_ACCESS_COMMANDS.REVOKE,
  });

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

  await expect(
    authority.patchStaffAccess(actor.githubId, target.id, {
      command: STAFF_ACCESS_COMMANDS.REVOKE,
    }),
  ).rejects.toMatchObject({
    errorCode: { code: 'ROL_013', status: 409 },
  });
  await expect(
    prisma.staffAccessRequest.count({
      where: { userId: target.id, status: StaffAccessRequestStatus.REVOKED },
    }),
  ).resolves.toBe(1);

  await expect(roles.getMyRequest(target.githubId)).resolves.toMatchObject({
    status: StaffAccessRequestStatus.REVOKED,
  });

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
