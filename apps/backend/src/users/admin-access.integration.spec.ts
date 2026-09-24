import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { AdminAccessController } from './admin-access.controller';
import { BarrierIndependentAuthorityRepository } from './admin-access.integration-support';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { ADMIN_ACCESS_COMMANDS } from './domain/independent-authority';
import { PatchAdminAccessRequestDto } from './dto/patch-admin-access.dto';
import { IndependentAuthorityRepository } from './independent-authority.repository';
import { IndependentAuthorityService } from './independent-authority.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new AdminAccessRepository(prisma);
const auditLog = new AuditLogService(new AuditLogRepository(prisma));
const service = new AdminAccessService(repository, auditLog);
const AUDIT_FAILURE_FUNCTION = 'fail_admin_access_audit_insert';
const AUDIT_FAILURE_TRIGGER = 'fail_admin_access_audit_insert_trigger';
const AUDIT_FAILURE_MESSAGE = 'synthetic admin access audit failure';
let sequence = 0;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS ${AUDIT_FAILURE_TRIGGER} ON "AuditLog"`,
  );
  await prisma.$executeRawUnsafe(
    `DROP FUNCTION IF EXISTS ${AUDIT_FAILURE_FUNCTION}()`,
  );
  await prisma.$disconnect();
});

describe('Admin access real PostgreSQL transactions', () => {
  it('serializes two mutual admin demotions so exactly one commits', async () => {
    // Given
    await prisma.user.updateMany({
      where: { hasAdminAccess: true, accountStatus: AccountStatus.ACTIVE },
      data: { hasAdminAccess: false, hasStaffAccess: true },
    });
    const first = await createUser('ADMIN', 'race-a');
    const second = await createUser('ADMIN', 'race-b');
    // 표시 역할 PATCH는 독립 관리자 권한을 지우지 않는다. 마지막 관리자 직렬화는
    // 그 칸을 직접 바꾸는 독립 권한 경로에서 증명한다.
    const synchronizedService = new IndependentAuthorityService(
      new BarrierIndependentAuthorityRepository(
        new IndependentAuthorityRepository(prisma),
      ),
      auditLog,
    );
    // 서로를 강등한다 — actor가 자기 자신을 강등하면 #1382의 `ROL_022`가
    // 잠금 경쟁보다 먼저 답해 버려, 이 테스트가 재려는 직렬화가 실행되지 않는다.
    const demote = (actorGithubId: bigint, targetId: string) =>
      synchronizedService.patchAdminAccess(actorGithubId, targetId, {
        command: ADMIN_ACCESS_COMMANDS.REVOKE,
      });

    // When
    const results = await Promise.allSettled([
      demote(first.githubId, second.id),
      demote(second.githubId, first.id),
    ]);

    // Then
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    // 어느 쪽이 lockActiveAdmins()를 먼저 통과하는지는 실 DB 잠금 경쟁이라 정해지지
    // 않지만, 진 쪽의 actor는 이긴 트랜잭션이 방금 강등한 바로 그 계정이다.
    // 잠금이 풀린 뒤 재검증(TOCTOU 재조회)이 그것을 잡아 ADMIN_ONLY로 막는다 —
    // 잠금이 직렬화하지 못했다면 두 트랜잭션이 모두 통과해 활성 관리자가 0명이 된다.
    const reason = rejected?.reason as
      { errorCode?: { code: string; status: number } } | undefined;
    expect(reason?.errorCode).toMatchObject({
      code: RolesErrorCode.ADMIN_ONLY,
      status: 403,
    });
    await expect(
      prisma.user.count({
        where: { hasAdminAccess: true, accountStatus: AccountStatus.ACTIVE },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: { targetType: 'USER', targetId: { in: [first.id, second.id] } },
      }),
    ).resolves.toBe(1);
  });

  it('rolls back the user CAS when PostgreSQL rejects the audit insert', async () => {
    // Given
    const actor = await createUser('ADMIN', 'audit-actor');
    const target = await createUser('STUDENT', 'audit-target');
    await installAuditFailureTrigger();

    // When / Then
    await expect(
      service.patchAccess(actor.githubId, target.id, {
        expectedRole: 'STUDENT',
        desiredRole: 'STAFF',
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: null,
      }),
    ).rejects.toThrow(AUDIT_FAILURE_MESSAGE);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(
      prisma.auditLog.count({ where: { targetId: target.id } }),
    ).resolves.toBe(0);
  });

  it('returns the authoritative locked projection for a stale real-DB CAS', async () => {
    // Given
    const actor = await createUser('ADMIN', 'stale-actor');
    const target = await createUser('STUDENT', 'stale-target');
    await prisma.user.update({
      where: { id: target.id },
      data: { hasStaffAccess: true },
    });
    // 이 테스트는 patchAccess만 호출한다 — profile 서비스는 실제로 쓰이지 않으므로
    // 실행되면 실패하는 스텁만 채워 생성자 계약을 맞춘다.
    const profileService = {
      patchProfile: () => {
        throw new Error('patchProfile should not be called in this spec');
      },
    };
    const controller = new AdminAccessController(service, profileService);
    const request = {
      sessionGithubId: actor.githubId,
    } as Pick<AuthenticatedRequest, 'sessionGithubId'>;
    const body = Object.assign(new PatchAdminAccessRequestDto(), {
      expectedRole: 'STUDENT',
      desiredRole: 'ADMIN',
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    });

    // When
    const operation = controller.patchAccess(request, target.id, body);

    // Then
    await expect(operation).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ACCESS_STATE_MISMATCH, status: 409 },
      extensions: {
        currentAccess: {
          id: target.id,
          role: 'STAFF',
          accountStatus: AccountStatus.ACTIVE,
          pendingRequest: null,
        },
      },
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      hasStaffAccess: true,
      hasAdminAccess: false,
    });
  });
});

async function installAuditFailureTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION ${AUDIT_FAILURE_FUNCTION}()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION '${AUDIT_FAILURE_MESSAGE}';
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER ${AUDIT_FAILURE_TRIGGER}
    BEFORE INSERT ON "AuditLog"
    FOR EACH ROW
    EXECUTE FUNCTION ${AUDIT_FAILURE_FUNCTION}()
  `);
}

async function createUser(role: 'STUDENT' | 'STAFF' | 'ADMIN', label: string) {
  sequence += 1;
  return prisma.user.create({
    data: canonicalUserCreateFromLabel(role, {
      id: `test:pr03:admin-access:${label}:${sequence}`,
      githubId: 9_003_500_000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
    }),
    select: { id: true, githubId: true },
  });
}
