import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { StaffRoleRequestsRepository } from '../roles/staff-role-requests.repository';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
  createAccessAuditMetadata,
} from './audit-log-metadata';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:audit-log:append-only:';
const ROLLBACK_REQUEST_ID = `${TEST_PREFIX}rollback-request`;
const MISSING_ACTOR_GITHUB_ID = 9_402_999_999n;

describe('AuditLog append-only database enforcement', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
    const actor = await prisma.user.create({
      data: {
        id: `${TEST_PREFIX}actor`,
        githubId: 9_402_000_001n,
        nickname: 'synthetic-audit-actor',
        role: Role.ADMIN,
      },
    });
    const requestOwner = await prisma.user.create({
      data: {
        id: `${TEST_PREFIX}request-owner`,
        githubId: 9_402_000_002n,
        nickname: 'synthetic-request-owner',
      },
    });
    await prisma.roleRequest.create({
      data: {
        id: ROLLBACK_REQUEST_ID,
        userId: requestOwner.id,
      },
    });
    await prisma.auditLog.createMany({
      data: ['update', 'delete', 'truncate'].map((operation) => ({
        id: `${TEST_PREFIX}${operation}`,
        actorId: actor.id,
        action: 'SYNTHETIC_APPEND_ONLY_PROBE',
        targetType: 'SYNTHETIC',
        targetId: operation,
        metadata: {},
      })),
    });
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('raw SQL UPDATE를 거부한다', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "AuditLog" SET "action" = 'MUTATED' WHERE "id" = '${TEST_PREFIX}update'`,
      ),
    ).rejects.toThrow(/AuditLog is append-only/);
  });

  it('raw SQL DELETE를 거부한다', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM "AuditLog" WHERE "id" = '${TEST_PREFIX}delete'`,
      ),
    ).rejects.toThrow(/AuditLog is append-only/);
  });

  it('raw SQL TRUNCATE를 거부한다', async () => {
    await expect(
      prisma.$executeRawUnsafe('TRUNCATE TABLE "AuditLog"'),
    ).rejects.toThrow(/AuditLog is append-only/);
  });

  it('감사 삽입 실패는 같은 트랜잭션의 역할 요청 변경을 롤백한다', async () => {
    const roleRequests = new StaffRoleRequestsRepository(prisma);
    const auditLog = new AuditLogService(new AuditLogRepository(prisma));
    let domainTransitionApplied = false;

    await expect(
      roleRequests.withTransaction(async (store) => {
        domainTransitionApplied = await store.transitionRequest({
          requestId: ROLLBACK_REQUEST_ID,
          actorId: `${TEST_PREFIX}actor`,
          expectedStatus: RoleRequestStatus.PENDING,
          nextStatus: RoleRequestStatus.REJECTED,
          rejectionReason: 'synthetic forced audit failure',
          decidedAt: new Date('2026-07-31T13:00:00.000Z'),
        });
        await auditLog.record(
          {
            actorGithubId: MISSING_ACTOR_GITHUB_ID,
            action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REJECTED,
            targetType: 'ROLE_REQUEST',
            targetId: ROLLBACK_REQUEST_ID,
            metadata: createAccessAuditMetadata({
              eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED,
              actor: {
                displayName: null,
                githubLogin: 'synthetic-missing-actor',
              },
              before: {
                role: null,
                accountStatus: AccountStatus.ACTIVE,
                requestStatus: RoleRequestStatus.PENDING,
              },
              after: {
                role: null,
                accountStatus: AccountStatus.ACTIVE,
                requestStatus: RoleRequestStatus.REJECTED,
              },
              rejectionReason: 'synthetic forced audit failure',
            }),
          },
          store.auditLogWriter,
        );
      }),
    ).rejects.toMatchObject({ code: 'P2025' });
    expect(domainTransitionApplied).toBe(true);
    await expect(
      prisma.roleRequest.findUniqueOrThrow({
        where: { id: ROLLBACK_REQUEST_ID },
        select: {
          status: true,
          rejectionReason: true,
          decidedAt: true,
          decidedById: true,
        },
      }),
    ).resolves.toEqual({
      status: RoleRequestStatus.PENDING,
      rejectionReason: null,
      decidedAt: null,
      decidedById: null,
    });
  });
});
