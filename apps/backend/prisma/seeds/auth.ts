import { AccountStatus, ApprovalStatus, type User } from '@prisma/client';
import { offsetDays, seedId, SeedStats } from './helpers';
import {
  type SeedRole,
  upsertConsent,
  upsertSeedProfile,
  upsertSeedUser,
  upsertSeedRequest,
} from './user';

export const AUTH_SCENARIOS = {
  'consent-required': seedId('auth', 'consent-required'),
  'user-role-unselected': seedId('auth', 'user-role-unselected'),
  'profile-complete': seedId('auth', 'profile-complete'),
  'student-confirmed': seedId('auth', 'student-confirmed'),
  'staff-pending': seedId('auth', 'staff-pending'),
  'staff-pending-second': seedId('auth', 'staff-pending-second'),
  'staff-rejected': seedId('auth', 'staff-rejected'),
  'staff-approved': seedId('auth', 'staff-approved'),
  'staff-revocable': seedId('auth', 'staff-revocable'),
  'staff-revoked': seedId('auth', 'staff-revoked'),
  'admin-confirmed': seedId('auth', 'admin-confirmed'),
  'admin-second': seedId('auth', 'admin-second'),
  'student-onboarding-unassigned': seedId(
    'auth',
    'student-onboarding-unassigned',
  ),
  'staff-onboarding-unassigned': seedId('auth', 'staff-onboarding-unassigned'),
} as const;

type AuthScenarioId = keyof typeof AUTH_SCENARIOS;

async function upsertUser(
  stats: SeedStats,
  scenarioId: AuthScenarioId,
  role: SeedRole | null,
): Promise<User> {
  return upsertSeedUser(stats, { id: AUTH_SCENARIOS[scenarioId], role });
}

async function setProfile(
  userId: string,
  profile: {
    readonly name: string;
    readonly studentId: string | null;
    readonly department: string;
    readonly type: 'STUDENT' | 'STAFF';
  },
): Promise<void> {
  await upsertSeedProfile({
    userId,
    name: profile.name,
    studentId: profile.studentId,
    department: profile.department,
    type: profile.type,
  });
}

export async function seedAuth(stats: SeedStats): Promise<void> {
  const admin = await upsertUser(stats, 'admin-confirmed', 'ADMIN');
  await upsertConsent(stats, admin.id);

  await setProfile(admin.id, {
    type: 'STAFF',
    name: '합성 관리자',
    studentId: null,
    department: '오픈소스 SW 개발 사업단',
  });

  const adminSecond = await upsertUser(stats, 'admin-second', 'ADMIN');
  await upsertConsent(stats, adminSecond.id);
  await setProfile(adminSecond.id, {
    type: 'STAFF',
    name: '합성 두 번째 관리자',
    studentId: null,
    department: '오픈소스 SW 개발 사업단',
  });

  await upsertUser(stats, 'consent-required', null);

  const roleUnselected = await upsertUser(stats, 'user-role-unselected', null);
  await upsertConsent(stats, roleUnselected.id);

  const studentOnboardingUnassigned = await upsertUser(
    stats,
    'student-onboarding-unassigned',
    null,
  );
  await upsertConsent(stats, studentOnboardingUnassigned.id);

  const staffOnboardingUnassigned = await upsertUser(
    stats,
    'staff-onboarding-unassigned',
    null,
  );
  await upsertConsent(stats, staffOnboardingUnassigned.id);

  const profileComplete = await upsertUser(stats, 'profile-complete', null);
  await upsertConsent(stats, profileComplete.id);
  await setProfile(profileComplete.id, {
    type: 'STUDENT',
    name: '합성 완료 사용자',
    studentId: ['20', '2601'].join(''),
    department: '인공지능학부',
  });

  const studentConfirmed = await upsertUser(
    stats,
    'student-confirmed',
    'STUDENT',
  );
  await upsertConsent(stats, studentConfirmed.id);

  const staffPending = await upsertUser(stats, 'staff-pending', null);
  await upsertConsent(stats, staffPending.id);
  await setProfile(staffPending.id, {
    type: 'STAFF',
    name: '합성 대기 사용자',
    studentId: null,
    department: '인공지능학부',
  });
  await upsertSeedRequest(stats, {
    id: seedId('auth', 'staff-pending', 'role-request'),
    userId: staffPending.id,
    status: ApprovalStatus.PENDING,
    createdAt: offsetDays(-10),
  });

  const staffPendingSecond = await upsertUser(
    stats,
    'staff-pending-second',
    null,
  );
  await upsertConsent(stats, staffPendingSecond.id);

  await setProfile(staffPendingSecond.id, {
    type: 'STAFF',
    name: '합성 두 번째 대기 사용자',
    studentId: null,
    department: '소프트웨어공학과',
  });
  await upsertSeedRequest(stats, {
    id: seedId('auth', 'staff-pending-second', 'role-request'),
    userId: staffPendingSecond.id,
    status: ApprovalStatus.PENDING,

    createdAt: offsetDays(-5),
  });

  const staffRejected = await upsertUser(stats, 'staff-rejected', null);
  await upsertConsent(stats, staffRejected.id);
  await setProfile(staffRejected.id, {
    type: 'STAFF',
    name: '합성 반려 사용자',
    studentId: null,
    department: '컴퓨터공학과',
  });
  await upsertSeedRequest(stats, {
    id: seedId('auth', 'staff-rejected', 'role-request'),
    userId: staffRejected.id,
    status: ApprovalStatus.REJECTED,
    createdAt: offsetDays(-7),
    rejectionReason: '담당 프로그램 소속 확인 불가 (seed fixture)',
    decidedById: admin.id,
    decidedAt: offsetDays(-6),
  });

  const staffApproved = await upsertUser(stats, 'staff-approved', 'STAFF');
  await upsertConsent(stats, staffApproved.id);
  await upsertSeedRequest(stats, {
    id: seedId('auth', 'staff-approved', 'role-request'),
    userId: staffApproved.id,
    status: ApprovalStatus.APPROVED,
    createdAt: offsetDays(-9),
    decidedById: admin.id,
    decidedAt: offsetDays(-8),
  });

  const staffRevocable = await upsertUser(stats, 'staff-revocable', 'STAFF');
  await upsertConsent(stats, staffRevocable.id);
  await upsertSeedProfile({
    userId: staffRevocable.id,
    type: 'STAFF',
    departmentType: 'DEPARTMENT',
    name: '합성 활성 교직원',
    studentId: '202605',
    department: '전자컴퓨터공학부',
  });
  await upsertSeedRequest(stats, {
    id: seedId('auth', 'staff-revocable', 'role-request'),
    userId: staffRevocable.id,
    status: ApprovalStatus.APPROVED,
    createdAt: offsetDays(-4),
    decidedById: admin.id,
    decidedAt: offsetDays(-3),
  });

  const staffRevoked = await upsertSeedUser(stats, {
    id: AUTH_SCENARIOS['staff-revoked'],
    role: 'STAFF',
    accountStatus: AccountStatus.DEACTIVATED,
  });
  await upsertConsent(stats, staffRevoked.id);

  await upsertSeedRequest(stats, {
    id: seedId('auth', 'staff-revoked', 'role-request-approved'),
    userId: staffRevoked.id,
    status: ApprovalStatus.APPROVED,
    createdAt: offsetDays(-30),
    decidedById: admin.id,
    decidedAt: offsetDays(-29),
  });
  await upsertSeedRequest(stats, {
    id: seedId('auth', 'staff-revoked', 'role-request-revoked'),
    userId: staffRevoked.id,
    status: ApprovalStatus.REVOKED,
    createdAt: offsetDays(-2),
    decidedById: admin.id,
    decidedAt: offsetDays(-1),
  });

  for (let index = 1; index <= 10; index += 1) {
    const ordinal = index.toString().padStart(2, '0');
    await upsertSeedUser(stats, {
      id: seedId('auth', 'pagination', ordinal),
      role: 'STUDENT',
    });
  }
}
