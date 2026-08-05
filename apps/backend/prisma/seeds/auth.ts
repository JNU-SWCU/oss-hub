import { AccountStatus, Role, RoleRequestStatus, User } from '@prisma/client';
import { upsertCompatibleProfile } from '../../src/profiles/profile-compatibility.repository';
import {
  offsetDays,
  prisma,
  seedId,
  SeedStats,
  upsertConsent,
  upsertSeedUser,
  upsertTracked,
} from './helpers';

/** #110 auth 시나리오 카탈로그 — scenario id로 대응 User.id를 조회할 수 있다. */
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
} as const;

type AuthScenarioId = keyof typeof AUTH_SCENARIOS;

async function upsertUser(
  stats: SeedStats,
  scenarioId: AuthScenarioId,
  role: Role | null,
): Promise<User> {
  return upsertSeedUser(stats, { id: AUTH_SCENARIOS[scenarioId], role });
}

async function setProfile(
  userId: string,
  profile:
    | {
        readonly name: string;
        readonly studentId: null;
        readonly department: null;
      }
    | {
        readonly name: string;
        readonly studentId: string;
        readonly department: string;
      },
): Promise<void> {
  if (profile.studentId === null) {
    await prisma.user.update({ where: { id: userId }, data: profile });
    return;
  }
  await prisma.$transaction((transaction) =>
    upsertCompatibleProfile(transaction, userId, profile),
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
  // 이름을 채우지 않으면 관리자 화면에 들어갈 수 없다. ADMIN의 프로필 완료 요건은
  // 이름 하나뿐인데(`user-profile-policy.ts`의 REQUIREMENT_BY_ROLE), 그것이 비면
  // 세션의 `isProfileComplete`가 false가 되고 `role-gate.tsx`가 `/admin/access`
  // 진입을 `/onboarding/profile`로 되돌린다 — 세션을 mock하는 단위 테스트는 이 구멍을
  // 영원히 못 잡는다(#184).
  //
  // 학번·학과는 ADMIN 요건이 아니라 null로 둔다. 단순한 생략이 아니라 유일하게 가능한
  // 값이다 — 학번 없이 학과만 채운 행은 `user-profile-backfill.ts`의
  // `classifyLegacyProfile`이 IMPOSSIBLE_PARTIAL로 거부해 시드 실행 자체가 실패한다.
  await setProfile(admin.id, {
    name: '합성 관리자',
    studentId: null,
    department: null,
  });

  // 두 번째 ADMIN. 관리자 경쟁 처리(#184 인수 조건: 409 후 목록 재조회)를 **서로 다른 두
  // 세션**으로 만들 수 있게 한다. 409 자체는 한 명으로도 난다 — CAS
  // (`matchesExpectedAccessState`)는 actor를 보지 않고 기대 상태만 비교하므로, 같은
  // 세션의 API 컨텍스트로 선행 PATCH를 쏴도 뒤이은 화면 클릭은 409를 받는다. 그런데도
  // 두 번째 계정을 두는 이유는 결정 이력에 남는 `decidedBy`(관리자 상세 화면이 그대로
  // 그린다) 때문이다. 한 명뿐이면 "다른 관리자가 먼저 처리했다"와 "내가 처리했다"가
  // 화면에서 같은 이름으로 보여 단언이 헛돈다.
  const adminSecond = await upsertUser(stats, 'admin-second', Role.ADMIN);
  await upsertConsent(stats, adminSecond.id);
  await setProfile(adminSecond.id, {
    name: '합성 두 번째 관리자',
    studentId: null,
    department: null,
  });

  await upsertUser(stats, 'consent-required', null);
  // Consent를 만들지 않는다 — 동의 전 상태 자체가 이 시나리오다.

  const roleUnselected = await upsertUser(stats, 'user-role-unselected', null);
  await upsertConsent(stats, roleUnselected.id);
  await setProfile(roleUnselected.id, {
    name: 'GitHub 합성 이름',
    studentId: null,
    department: null,
  });

  const profileComplete = await upsertUser(stats, 'profile-complete', null);
  await upsertConsent(stats, profileComplete.id);
  await setProfile(profileComplete.id, {
    name: '합성 완료 사용자',
    studentId: ['20', '2601'].join(''),
    department: '인공지능학부',
  });

  const studentConfirmed = await upsertUser(
    stats,
    'student-confirmed',
    Role.STUDENT,
  );
  await upsertConsent(stats, studentConfirmed.id);

  const staffPending = await upsertUser(stats, 'staff-pending', null);
  await upsertConsent(stats, staffPending.id);
  await setProfile(staffPending.id, {
    name: '합성 대기 사용자',
    studentId: '202602',
    department: '인공지능학부',
  });
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
  await setProfile(staffPendingSecond.id, {
    name: '합성 두 번째 대기 사용자',
    studentId: '202603',
    department: '소프트웨어공학과',
  });
  await upsertRoleRequest(stats, {
    id: seedId('auth', 'staff-pending-second', 'role-request'),
    userId: staffPendingSecond.id,
    status: RoleRequestStatus.PENDING,
    // staff-pending보다 나중에 신청한 두 번째 PENDING — 정렬·페이지 검증용.
    createdAt: offsetDays(-5),
  });

  const staffRejected = await upsertUser(stats, 'staff-rejected', null);
  await upsertConsent(stats, staffRejected.id);
  await setProfile(staffRejected.id, {
    name: '합성 반려 사용자',
    studentId: '202604',
    department: '컴퓨터공학과',
  });
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

  // 회수 e2e가 **회수 버튼을 누를 대상**이다(#184). 아래 `staff-revoked`를 쓸 수 없어
  // 따로 둔다 — 그쪽은 `accountStatus: DEACTIVATED`라 `RolesService.requireUser`가
  // ACTIVE가 아닌 계정을 401로 막고, 세션을 위조해도 로그인 자체가 되지 않아 "회수 직후
  // 화면"을 만들 수 없다. 그 페르소나는 회수가 끝난 뒤의 상태를 쓰는 다른 시나리오용이라
  // 그대로 둔다.
  //
  // 전제는 ACTIVE · STAFF · APPROVED 요청 · 프로필 완료 넷이다. STAFF의 완료 요건은
  // 이름·학과이고 학번은 선택인데(`user-profile-policy.ts`), 여기서는 학번까지 채운다.
  // 학번을 비우면 학과만 실린 행이 되어 `user-profile-backfill.ts`가 IMPOSSIBLE_PARTIAL로
  // 거부하고 시드가 통째로 실패한다. 학번을 채운 프로필은 STAFF 요건의 상위집합이고
  // (학번이 실제로 있는 조교형 교직원), UserProfile 행까지 만들어 다른 페르소나와 모양이
  // 같다.
  const staffRevocable = await upsertUser(stats, 'staff-revocable', Role.STAFF);
  await upsertConsent(stats, staffRevocable.id);
  await setProfile(staffRevocable.id, {
    name: '합성 활성 교직원',
    studentId: '202605',
    department: '전자컴퓨터공학부',
  });
  await upsertRoleRequest(stats, {
    id: seedId('auth', 'staff-revocable', 'role-request'),
    userId: staffRevocable.id,
    status: RoleRequestStatus.APPROVED,
    createdAt: offsetDays(-4),
    decidedById: admin.id,
    decidedAt: offsetDays(-3),
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
