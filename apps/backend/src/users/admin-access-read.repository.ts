import {
  AccountStatus,
  LoginHistoryEvent,
  Role,
  RoleRequestStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  compatibleProfileNameWhere,
  COMPATIBLE_PROFILE_SELECT,
  resolveCompatibleProfile,
} from '../profiles/profile-compatibility';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ADMIN_ACCESS_PENDING_FILTERS,
  ADMIN_ACCESS_ROLE_FILTERS,
  type AdminAccessFacets,
  type AdminAccessListQuery,
} from './domain/admin-access';
import type {
  AdminAccessUserDetailRecord,
  AdminAccessUserPageRecord,
  AdminAccessUserRecord,
} from './admin-access.repository.types';
import { listOrderedAdminAccessUserIds } from './admin-access-read-ordering';
import {
  isCompleteUserProfile,
  type UserProfileFields,
} from './user-profile-policy';

export const ADMIN_ACCESS_USER_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  role: true,
  /**
   * 확정 전 프로필 판정의 세 번째 근거 — 관리자 화면도 같은 근거를 봐야 한다(#184).
   *
   * 스칼라 컬럼이라 아래 `roleRequests`·`loginHistories`처럼 "첫 행"의 의미를 만드는
   * 관계 select와 성질이 다르다. 이 값을 더한다고 그 배열들의 내용이 달라지지 않는다.
   */
  selectedRole: true,
  accountStatus: true,
  ...COMPATIBLE_PROFILE_SELECT,
  roleRequests: {
    where: { status: RoleRequestStatus.PENDING },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: { id: true, status: true, createdAt: true },
  },
  loginHistories: {
    where: { event: LoginHistoryEvent.LOGIN, success: true },
    orderBy: [{ loginAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: { loginAt: true },
  },
} as const satisfies Prisma.UserSelect;

type PrismaAdminAccessUser = Prisma.UserGetPayload<{
  select: typeof ADMIN_ACCESS_USER_SELECT;
}>;

export async function listAdminAccessUsers(
  prisma: Pick<PrismaService, 'user' | '$queryRaw'>,
  query: AdminAccessListQuery,
): Promise<AdminAccessUserPageRecord> {
  const where = adminAccessWhere(query);
  const [orderedIds, total, facets] = await Promise.all([
    listOrderedAdminAccessUserIds(prisma, query),
    prisma.user.count({ where }),
    listAdminAccessFacets(prisma, query),
  ]);
  const ids = orderedIds.map(({ id }) => id);
  const users =
    ids.length === 0
      ? []
      : await prisma.user.findMany({
          where: { AND: [where, { id: { in: ids } }] },
          select: ADMIN_ACCESS_USER_SELECT,
        });
  const usersById = new Map(users.map((user) => [user.id, user] as const));
  return {
    items: ids.flatMap((id) => {
      const user = usersById.get(id);
      return user ? [toAdminAccessUserRecord(user)] : [];
    }),
    page: query.page,
    limit: query.limit,
    total,
    facets,
  };
}

export async function listAdminAccessFacets(
  prisma: Pick<PrismaService, 'user'>,
  query: AdminAccessListQuery,
): Promise<AdminAccessFacets> {
  const roleBase = adminAccessWhere(query, 'role');
  const accountStatusBase = adminAccessWhere(query, 'accountStatus');
  const pendingRequestBase = adminAccessWhere(query, 'pendingRequest');
  const [
    unassigned,
    student,
    staff,
    admin,
    active,
    deactivated,
    none,
    pending,
  ] = await Promise.all([
    prisma.user.count({ where: { ...roleBase, role: null } }),
    prisma.user.count({ where: { ...roleBase, role: Role.STUDENT } }),
    prisma.user.count({ where: { ...roleBase, role: Role.STAFF } }),
    prisma.user.count({ where: { ...roleBase, role: Role.ADMIN } }),
    prisma.user.count({
      where: { ...accountStatusBase, accountStatus: AccountStatus.ACTIVE },
    }),
    prisma.user.count({
      where: {
        ...accountStatusBase,
        accountStatus: AccountStatus.DEACTIVATED,
      },
    }),
    prisma.user.count({
      where: {
        ...pendingRequestBase,
        roleRequests: { none: { status: RoleRequestStatus.PENDING } },
      },
    }),
    prisma.user.count({
      where: {
        ...pendingRequestBase,
        roleRequests: { some: { status: RoleRequestStatus.PENDING } },
      },
    }),
  ]);
  return {
    roles: { unassigned, student, staff, admin },
    accountStatuses: { active, deactivated },
    pendingRequests: { none, pending },
  };
}

export async function findAdminAccessUserById(
  prisma: Pick<PrismaService, 'user'>,
  userId: string,
): Promise<AdminAccessUserDetailRecord | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: ADMIN_ACCESS_USER_SELECT,
  });
  return user ? toAdminAccessUserDetailRecord(user) : null;
}

export function toAdminAccessUserRecord(
  user: PrismaAdminAccessUser,
): AdminAccessUserRecord {
  const profile = resolveCompatibleProfile(user);
  const pendingRequest = user.roleRequests[0];
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    name: profile.name,
    role: user.role,
    accountStatus: user.accountStatus,
    isProfileComplete: isCompleteAdminAccessProfile(user, profile),
    pendingRequest: pendingRequest
      ? {
          id: pendingRequest.id,
          status: RoleRequestStatus.PENDING,
          createdAt: pendingRequest.createdAt,
        }
      : null,
    lastLoginAt: user.loginHistories[0]?.loginAt ?? null,
  };
}

function toAdminAccessUserDetailRecord(
  user: PrismaAdminAccessUser,
): AdminAccessUserDetailRecord {
  const profile = resolveCompatibleProfile(user);
  return {
    ...toAdminAccessUserRecord(user),
    profile: {
      ...profile,
      isComplete: isCompleteAdminAccessProfile(user, profile),
    },
  };
}

/**
 * 관리자 화면의 프로필 완료 판정 — 역할 맥락을 함께 넘긴다(#577).
 *
 * 프로필 값(이름·학번·학과)만 넘기면 `effectiveProfileRole`이 역할을 알 수 없어
 * `DEFAULT_PROFILE_ROLE`(학생) 기준으로 떨어진다. 승인 대기 교직원은 승인 전까지
 * `role`이 null이라 전원이 그 경로를 타고, 화면 안내대로 학번을 비워 둔 사람이
 * 미완료로 판정돼 `requiresCompleteProfile` 가드에 막혀 영구히 승인되지 못했다.
 *
 * 살아 있는 교직원 요청의 정의는 `users.repository.ts`의 `hasPendingStaffRequest`와
 * 같다 — `roleRequests`를 PENDING만 골라 오고(`ADMIN_ACCESS_USER_SELECT`) 그 존재
 * 여부를 그대로 쓴다. 승인된(APPROVED) 요청은 이미 `role`에 STAFF가 붙으므로 별도
 * 취급이 필요 없다. 판정 규칙 자체(`user-profile-policy.ts`)는 그대로 둔다.
 *
 * ## 고른 역할도 함께 넘긴다 (#184)
 *
 * 예전에는 근거를 둘만 넘겼다(`role`·`hasPendingStaffRequest`). 확정을 `가입 마치기`로
 * 미룬 뒤(#569) 셋째 근거가 생겼는데(`selectedRole`) 여기만 그것을 모르고 있었고,
 * **회수된 교직원이 정확히 그 셋에 하나도 걸리지 않는 사람**이다: `role`은 비었고, 살아
 * 있는 요청도 없으며, 남은 근거는 고른 역할뿐이다. 넘기지 않으면 학생 기준으로 떨어져
 * 학번 없는 그의 프로필이 미완료로 뜬다 — 본인 화면(`users.repository.ts`)은 완료로
 * 보여 주는데 관리자 화면만 미완료다. **같은 사람이 두 화면에서 다르게 보이면 그것은
 * 계약이 아니다.**
 *
 * 승인 게이트가 느슨해지지는 않는다. `requiresCompleteProfile`은 요청을 승인하는 전이
 * 하나에만 붙고(`admin-access-transition-table.ts`), 그 전이는 PENDING 요청이 있어야
 * 성립한다 — 그런 사용자는 둘째 근거로 이미 교직원 기준을 받고 있었다. 셋째 근거가
 * 답을 바꾸는 대상은 **승인 게이트를 지나지 않는 사람들뿐**이다.
 */
function isCompleteAdminAccessProfile(
  user: PrismaAdminAccessUser,
  profile: UserProfileFields,
): boolean {
  return isCompleteUserProfile({
    id: user.id,
    ...profile,
    role: user.role,
    hasPendingStaffRequest: user.roleRequests.length > 0,
    selectedRole: user.selectedRole,
  });
}

type FacetDimension = 'role' | 'accountStatus' | 'pendingRequest';

function adminAccessWhere(
  query: AdminAccessListQuery,
  omitted?: FacetDimension,
): Prisma.UserWhereInput {
  const profileConditions = query.query
    ? (compatibleProfileNameWhere(query.query).OR ?? [])
    : [];
  return {
    ...(query.query
      ? {
          OR: [
            ...profileConditions,
            {
              nickname: {
                contains: query.query,
                mode: 'insensitive' as const,
              },
            },
          ],
        }
      : {}),
    ...(omitted === 'role' || query.role === undefined
      ? {}
      : {
          role:
            query.role === ADMIN_ACCESS_ROLE_FILTERS.UNASSIGNED
              ? null
              : query.role,
        }),
    ...(omitted === 'accountStatus' || query.accountStatus === undefined
      ? {}
      : { accountStatus: query.accountStatus }),
    ...(omitted === 'pendingRequest' || query.pendingRequest === undefined
      ? {}
      : {
          roleRequests:
            query.pendingRequest === ADMIN_ACCESS_PENDING_FILTERS.PENDING
              ? { some: { status: RoleRequestStatus.PENDING } }
              : { none: { status: RoleRequestStatus.PENDING } },
        }),
  };
}
