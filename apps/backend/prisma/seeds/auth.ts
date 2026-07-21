import { AccountStatus, Role, RoleRequestStatus, User } from '@prisma/client';
import { CONSENT_POLICY_VERSION } from '../../src/consents/domain/consent-policy';
import {
  offsetDays,
  prisma,
  seedId,
  SeedStats,
  upsertSeedUser,
  upsertTracked,
} from './helpers';

/** #110 auth 시나리오 카탈로그 — scenario id로 대응 User.id를 조회할 수 있다. */
export const AUTH_SCENARIOS = {
  'consent-required': seedId('auth', 'consent-required'),
  'user-role-unselected': seedId('auth', 'user-role-unselected'),
  'student-confirmed': seedId('auth', 'student-confirmed'),
  'staff-pending': seedId('auth', 'staff-pending'),
  'staff-pending-second': seedId('auth', 'staff-pending-second'),
  'staff-rejected': seedId('auth', 'staff-rejected'),
  'staff-approved': seedId('auth', 'staff-approved'),
  'staff-revoked': seedId('auth', 'staff-revoked'),
  'admin-confirmed': seedId('auth', 'admin-confirmed'),
} as const;

type AuthScenarioId = keyof typeof AUTH_SCENARIOS;

async function upsertUser(
  stats: SeedStats,
  scenarioId: AuthScenarioId,
  role: Role | null,
): Promise<User> {
  return upsertSeedUser(stats, { id: AUTH_SCENARIOS[scenarioId], role });
}

async function upsertConsent(stats: SeedStats, userId: string): Promise<void> {
  await upsertTracked(
    stats,
    'Consent',
    () =>
      prisma.consent.findUnique({
        where: {
          userId_policyVersion: {
            userId,
            policyVersion: CONSENT_POLICY_VERSION,
          },
        },
      }),
    () =>
      prisma.consent.upsert({
        where: {
          userId_policyVersion: {
            userId,
            policyVersion: CONSENT_POLICY_VERSION,
          },
        },
        update: {},
        create: { userId, policyVersion: CONSENT_POLICY_VERSION },
      }),
  );
}

async function upsertRoleRequest(
  stats: SeedStats,
  params: {
    id: string;
    userId: string;
    status: RoleRequestStatus;
    createdAt: Date;
    rejectionReason?: string;
    decidedById?: string;
    decidedAt?: Date;
  },
): Promise<void> {
  const { id, ...rest } = params;
  await upsertTracked(
    stats,
    'RoleRequest',
    () => prisma.roleRequest.findUnique({ where: { id } }),
    () =>
      prisma.roleRequest.upsert({
        where: { id },
        update: rest,
        create: { id, ...rest },
      }),
  );
}

export async function seedAuth(stats: SeedStats): Promise<void> {
  // admin-confirmed를 가장 먼저 만들어 이후 시나리오의 decidedById로 재사용한다.
  const admin = await upsertUser(stats, 'admin-confirmed', Role.ADMIN);
  await upsertConsent(stats, admin.id);

  await upsertUser(stats, 'consent-required', null);
  // Consent를 만들지 않는다 — 동의 전 상태 자체가 이 시나리오다.

  const roleUnselected = await upsertUser(stats, 'user-role-unselected', null);
  await upsertConsent(stats, roleUnselected.id);

  const studentConfirmed = await upsertUser(
    stats,
    'student-confirmed',
    Role.STUDENT,
  );
  await upsertConsent(stats, studentConfirmed.id);

  const staffPending = await upsertUser(stats, 'staff-pending', null);
  await upsertConsent(stats, staffPending.id);
  await upsertRoleRequest(stats, {
    id: seedId('auth', 'staff-pending', 'role-request'),
    userId: staffPending.id,
    status: RoleRequestStatus.PENDING,
    createdAt: offsetDays(-10),
  });

  const staffPendingSecond = await upsertUser(
    stats,
    'staff-pending-second',
    null,
  );
  await upsertConsent(stats, staffPendingSecond.id);
  await upsertRoleRequest(stats, {
    id: seedId('auth', 'staff-pending-second', 'role-request'),
    userId: staffPendingSecond.id,
    status: RoleRequestStatus.PENDING,
    // staff-pending보다 나중에 신청한 두 번째 PENDING — 정렬·페이지 검증용.
    createdAt: offsetDays(-5),
  });

  const staffRejected = await upsertUser(stats, 'staff-rejected', null);
  await upsertConsent(stats, staffRejected.id);
  await upsertRoleRequest(stats, {
    id: seedId('auth', 'staff-rejected', 'role-request'),
    userId: staffRejected.id,
    status: RoleRequestStatus.REJECTED,
    createdAt: offsetDays(-7),
    rejectionReason: '담당 프로그램 소속 확인 불가 (seed fixture)',
    decidedById: admin.id,
    decidedAt: offsetDays(-6),
  });

  const staffApproved = await upsertUser(stats, 'staff-approved', Role.STAFF);
  await upsertConsent(stats, staffApproved.id);
  await upsertRoleRequest(stats, {
    id: seedId('auth', 'staff-approved', 'role-request'),
    userId: staffApproved.id,
    status: RoleRequestStatus.APPROVED,
    createdAt: offsetDays(-9),
    decidedById: admin.id,
    decidedAt: offsetDays(-8),
  });

  const staffRevoked = await upsertSeedUser(stats, {
    id: AUTH_SCENARIOS['staff-revoked'],
    role: Role.STAFF,
    accountStatus: AccountStatus.DEACTIVATED,
  });
  await upsertConsent(stats, staffRevoked.id);
  // 역할은 STAFF로 보존하고 계정만 비활성화한다. 승인·회수 이력도 모두 남긴다(#187, #188).
  await upsertRoleRequest(stats, {
    id: seedId('auth', 'staff-revoked', 'role-request-approved'),
    userId: staffRevoked.id,
    status: RoleRequestStatus.APPROVED,
    createdAt: offsetDays(-30),
    decidedById: admin.id,
    decidedAt: offsetDays(-29),
  });
  await upsertRoleRequest(stats, {
    id: seedId('auth', 'staff-revoked', 'role-request-revoked'),
    userId: staffRevoked.id,
    status: RoleRequestStatus.REVOKED,
    createdAt: offsetDays(-2),
    decidedById: admin.id,
    decidedAt: offsetDays(-1),
  });
}
