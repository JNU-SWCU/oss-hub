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
