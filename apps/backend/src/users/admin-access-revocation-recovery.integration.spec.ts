import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import {
  AccountStatus,
  LoginHistoryEvent,
  ProgramCategory,
  RepositorySource,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new AdminAccessRepository(prisma);
const service = new AdminAccessService(
  repository,
  new AuditLogService(new AuditLogRepository(prisma)),
);
const TEST_PREFIX = 'test:pr04h:admin-access-revocation-recovery:';
let sequence = 0;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Admin access account status transitions (PR04H, formerly StaffAccessRequestsService.decide)', () => {
  it('DEACTIVATED 전환은 STAFF 역할과 연결 자산을 보존하고 계정만 비활성화하며, 재활성화도 동일하게 보존한다', async () => {
    sequence += 1;
    const prefix = `${TEST_PREFIX}${sequence}:`;
    const actor = await createUser('ADMIN', `${prefix}admin`);
    const target = await createUser('STAFF', `${prefix}staff`);
    await createPreservedAssets(prefix, target.id);

    const deactivated = await service.patchAccess(actor.githubId, target.id, {
      expectedRole: 'STAFF',
      desiredRole: 'STAFF',
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.DEACTIVATED,
      expectedPendingRequest: null,
    });

    expect(deactivated).toMatchObject({
      role: 'STAFF',
      accountStatus: AccountStatus.DEACTIVATED,
      decidedRequest: null,
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.DEACTIVATED,
    });
    await expect(countPreservedAssets(prefix, target.id)).resolves.toEqual({
      consents: 1,
      loginHistories: 1,
      programs: 1,
      applications: 1,
      repositories: 1,
    });

    const reactivated = await service.patchAccess(actor.githubId, target.id, {
      expectedRole: 'STAFF',
      desiredRole: 'STAFF',
      expectedAccountStatus: AccountStatus.DEACTIVATED,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    });

    expect(reactivated).toMatchObject({
      role: 'STAFF',
      accountStatus: AccountStatus.ACTIVE,
      decidedRequest: null,
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(countPreservedAssets(prefix, target.id)).resolves.toEqual({
      consents: 1,
      loginHistories: 1,
      programs: 1,
      applications: 1,
      repositories: 1,
    });
  });
});

async function createUser(
  role: 'STUDENT' | 'STAFF' | 'ADMIN' | null,
  label: string,
) {
  sequence += 1;
  return prisma.user.create({
    data: canonicalUserCreateFromLabel(role, {
      id: `${label}:user`,
      githubId: 9_004_800_000n + BigInt(sequence),
      nickname: `synthetic-pr04h-${sequence}`,
    }),
    select: { id: true, githubId: true },
  });
}

async function createPreservedAssets(
  prefix: string,
  staffId: string,
): Promise<void> {
  await Promise.all([
    prisma.consent.create({
      data: {
        id: `${prefix}consent`,
        userId: staffId,
        policyVersion: 'synthetic-pr04h-policy',
      },
    }),
    prisma.loginHistory.create({
      data: {
        id: `${prefix}login-history`,
        userId: staffId,
        event: LoginHistoryEvent.LOGIN,
        success: true,
      },
    }),
  ]);
  const program = await prisma.program.create({
    data: {
      id: `${prefix}program`,
      name: 'Synthetic PR04H Program',
      organizer: 'Synthetic Organizer',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'synthetic-pr04h-template',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-07-31T00:00:00.000Z'),
      description: 'Synthetic account lifecycle fixture (PR04H)',
    },
  });
  const team = await prisma.team.create({
    data: {
      id: `${prefix}team`,
      programId: program.id,
      name: `${prefix}team`,
      joinCodeDigest: `${prefix}team-digest`,
      leaderId: staffId,
    },
  });
  await prisma.teamMember.create({
    data: {
      id: `${prefix}team-member`,
      teamId: team.id,
      programId: program.id,
      userId: staffId,
    },
  });
  const application = await prisma.application.create({
    data: {
      id: `${prefix}application`,
      programId: program.id,
      applicantId: staffId,
      teamId: team.id,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.githubRepository.create({
    data: {
      id: `${prefix}repository`,
      applicationId: application.id,
      programId: program.id,
      githubRepositoryId: 9_004_800_000n + BigInt(sequence),
      nameWithOwner: `synthetic-org/synthetic-pr04h-repository-${sequence}`,
      source: RepositorySource.ORG_PROVISIONED,
    },
  });
}

async function countPreservedAssets(
  prefix: string,
  staffId: string,
): Promise<{
  readonly consents: number;
  readonly loginHistories: number;
  readonly programs: number;
  readonly applications: number;
  readonly repositories: number;
}> {
  const [consents, loginHistories, programs, applications, repositories] =
    await Promise.all([
      prisma.consent.count({ where: { userId: staffId } }),
      prisma.loginHistory.count({ where: { userId: staffId } }),
      prisma.program.count({ where: { id: `${prefix}program` } }),
      prisma.application.count({ where: { applicantId: staffId } }),
      prisma.githubRepository.count({ where: { id: `${prefix}repository` } }),
    ]);
  return {
    consents,
    loginHistories,
    programs,
    applications,
    repositories,
  };
}
