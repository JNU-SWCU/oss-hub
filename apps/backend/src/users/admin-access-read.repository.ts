import type { UserType } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import {
  LoginHistoryEvent,
  AccountStatus,
  type ApprovalStatus,
  type Prisma,
} from '@prisma/client';
import { MemberKind, StaffAccessRequestStatus } from './user-contract.config';
import type { PrismaService } from '../platform/prisma.service';
import { USER_AUTHORITY_SELECT } from '../platform/user-profile-read.config';
import { USER_APPROVAL_SELECT } from './user-history.config';
import type { UserHistoryTransaction } from './user-history.repository';
import {
  AdminAccessReadOrderingRepository,
  type AdminAccessFacets,
  type AdminAccessListQuery,
  type AdminAccessLoginHistoryPage,
  type AdminAccessStaffAccessRequestHistoryPage,
  type AdminAccessUser,
  type AdminAccessUserDetail,
} from './admin-access-read-ordering.repository';

const PENDING_WHERE = {
  type: 'STAFF',
  approvalStatus: 'PENDING',
  approvalRequestId: { not: null },
} as const;
const STAFF_WHERE = {
  type: 'STAFF',
  approvalStatus: 'APPROVED',
  profileCreatedAt: { not: null },
  name: { not: null },
  department: { not: null },
} as const;

@Injectable()
export class AdminAccessReadRepository {
  constructor(private readonly ordering: AdminAccessReadOrderingRepository) {}
  async listAdminAccessUsers(
    prisma: Pick<PrismaService, 'user' | '$queryRaw'>,
    query: AdminAccessListQuery,
    context: 'directory' | 'requestQueue' = 'directory',
  ): Promise<AdminAccessUserPageRecord> {
    const where = adminAccessWhere(query);
    const [ordered, total, facets] = await Promise.all([
      this.ordering.listOrderedAdminAccessUserIds(prisma, query, context),
      prisma.user.count({ where }),
      this.listAdminAccessFacets(prisma, query),
    ]);
    const ids = ordered.map((row) => row.id);
    const users =
      ids.length === 0
        ? []
        : await prisma.user.findMany({
            where: { AND: [where, { id: { in: ids } }] },
            select: this.ADMIN_ACCESS_USER_SELECT,
          });
    const byId = new Map(users.map((user) => [user.id, user]));
    return {
      items: ids.flatMap((id) => {
        const user = byId.get(id);
        return user ? [this.toAdminAccessUserRow(user)] : [];
      }),
      page: query.page,
      limit: query.limit,
      total,
      facets,
    };
  }
  async listAdminAccessFacets(
    prisma: Pick<PrismaService, 'user'>,
    query: AdminAccessListQuery,
  ): Promise<AdminAccessFacets> {
    const roleBase = adminAccessWhere(query, 'role');
    const statusBase = adminAccessWhere(query, 'accountStatus');
    const pendingBase = adminAccessWhere(query, 'pendingRequest');
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
      prisma.user.count({
        where: { AND: [roleBase, roleWhere('UNASSIGNED')] },
      }),
      prisma.user.count({ where: { AND: [roleBase, roleWhere('STUDENT')] } }),
      prisma.user.count({ where: { AND: [roleBase, roleWhere('STAFF')] } }),
      prisma.user.count({ where: { AND: [roleBase, roleWhere('ADMIN')] } }),
      prisma.user.count({ where: { ...statusBase, accountStatus: 'ACTIVE' } }),
      prisma.user.count({
        where: { ...statusBase, accountStatus: 'DEACTIVATED' },
      }),
      prisma.user.count({
        where: { AND: [pendingBase, { NOT: PENDING_WHERE }] },
      }),
      prisma.user.count({ where: { AND: [pendingBase, PENDING_WHERE] } }),
    ]);
    return {
      roles: {
        unassigned: unassigned,
        student: student,
        staff: staff,
        admin: admin,
      },
      accountStatuses: { active: active, deactivated: deactivated },
      pendingRequests: { none: none, pending: pending },
    };
  }
  async findAdminAccessUserById(
    prisma: Pick<PrismaService, 'user'>,
    userId: string,
  ): Promise<AdminAccessUserDetailRow | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: this.ADMIN_ACCESS_USER_DETAIL_SELECT,
    });
    return user ? this.toAdminAccessUserDetailRow(user) : null;
  }
  toAdminAccessUserRow(user: AdminAccessUserSource): AdminAccessUserRow {
    return {
      id: user.id,
      githubId: user.githubId,
      githubLogin: user.nickname,
      name: user.name,
      studentId: user.studentId,
      department: user.department,
      memberKind: user.type === 'UNSELECTED' ? null : user.type,
      selectedMemberKind: user.type === 'UNSELECTED' ? null : user.type,
      hasAdminAccess: user.admin !== null,
      accountStatus: user.accountStatus,
      createdAt: user.createdAt,
      profileCreatedAt: user.profileCreatedAt,
      approvalStatus: user.approvalStatus,
      approvalRequestId: user.approvalRequestId,
      pendingRequest:
        user.type === 'STAFF' &&
        user.approvalStatus === 'PENDING' &&
        user.approvalRequestId !== null &&
        user.approvalRequestedAt !== null
          ? {
              id: user.approvalRequestId,
              status: 'PENDING',
              createdAt: user.approvalRequestedAt,
            }
          : null,
      lastLoginAt: user.loginHistories[0]?.loginAt ?? null,
    };
  }
  toAdminAccessUserDetailRow(
    user: AdminAccessUserDetailSource,
  ): AdminAccessUserDetailRow {
    return {
      ...this.toAdminAccessUserRow(user),
      staffNumber: user.staffNumber,
      adminGrant: user.admin
        ? { origin: user.admin.origin, grantedAt: user.admin.grantedAt }
        : null,
    };
  }
  readonly ADMIN_ACCESS_USER_SELECT = {
    id: true,
    githubId: true,
    nickname: true,
    createdAt: true,
    accountStatus: true,
    staffNumber: true,
    ...USER_AUTHORITY_SELECT,
    ...USER_APPROVAL_SELECT,
    loginHistories: {
      where: { event: LoginHistoryEvent.LOGIN, success: true },
      orderBy: [{ loginAt: 'desc' as const }, { id: 'desc' as const }],
      take: 1,
      select: { loginAt: true },
    },
  } as const satisfies Prisma.UserSelect;
  readonly ADMIN_ACCESS_USER_DETAIL_SELECT = {
    ...this.ADMIN_ACCESS_USER_SELECT,
    admin: { select: { userId: true, origin: true, grantedAt: true } },
  } as const satisfies Prisma.UserSelect;
}
function adminAccessWhere(
  query: AdminAccessListQuery,
  omitted?: 'role' | 'accountStatus' | 'pendingRequest',
): Prisma.UserWhereInput {
  const clauses: Prisma.UserWhereInput[] = [];
  if (query.query)
    clauses.push({
      OR: [
        { name: { contains: query.query, mode: 'insensitive' } },
        { nickname: { contains: query.query, mode: 'insensitive' } },
      ],
    });
  if (omitted !== 'role' && query.role !== undefined)
    clauses.push(roleWhere(query.role));
  if (omitted !== 'accountStatus' && query.accountStatus !== undefined)
    clauses.push({ accountStatus: query.accountStatus });
  if (omitted !== 'pendingRequest' && query.pendingRequest !== undefined)
    clauses.push(
      query.pendingRequest === 'PENDING'
        ? PENDING_WHERE
        : { NOT: PENDING_WHERE },
    );
  return { AND: clauses };
}
function roleWhere(
  role: NonNullable<AdminAccessListQuery['role']>,
): Prisma.UserWhereInput {
  switch (role) {
    case 'ADMIN':
      return { admin: { isNot: null } };
    case 'STAFF':
      return { ...STAFF_WHERE, admin: { is: null } };
    case 'STUDENT':
      return { type: 'STUDENT', admin: { is: null } };
    case 'UNASSIGNED':
      return {
        admin: { is: null },
        NOT: { OR: [{ type: 'STUDENT' }, STAFF_WHERE] },
      };
  }
}
export type AdminAccessActor = {
  readonly id: string;
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly memberKind: MemberKind | null;
  readonly approvalStatus: ApprovalStatus;
  readonly profileCreatedAt: Date | null;
  readonly department: string | null;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
};

export type AdminAccessPrincipal = {
  readonly githubId: bigint;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly isProfileComplete: boolean;
  readonly accountStatus: AccountStatus;
};

export type AdminAccessUserRecord = Omit<AdminAccessUser, 'isSelf'> & {
  readonly githubId: bigint;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export type AdminAccessUserRow = Omit<
  AdminAccessUserRecord,
  'role' | 'isProfileComplete' | 'hasStaffAccess'
> & {
  readonly selectedMemberKind: MemberKind | null;
  readonly profileCreatedAt: Date | null;
  readonly approvalStatus: ApprovalStatus;
  readonly approvalRequestId: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

export type AdminAccessUserDetailRow = AdminAccessUserRow & {
  readonly staffNumber: string | null;
  readonly adminGrant: AdminAccessUserDetail['adminGrant'];
};

export type AdminAccessUserDetailRecord = Omit<
  AdminAccessUserDetail,
  'isSelf'
> & {
  readonly githubId: bigint;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export type AdminAccessUserPageRecord = {
  readonly items: readonly AdminAccessUserRow[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly facets: AdminAccessFacets;
};

export type AdminAccessUserUpdate = {
  readonly userId: string;

  readonly expectedHasStaffAccess: boolean;
  readonly expectedHasAdminAccess: boolean;
  readonly expectedAccountStatus: AccountStatus;
  readonly desiredAccountStatus: AccountStatus;
  readonly decidesPendingRequest: boolean;
  readonly desiredHasStaffAccess: boolean;
  readonly desiredHasAdminAccess: boolean;
  readonly actorId: string;
  readonly expectedType: UserType;
  readonly expectedApprovalStatus: ApprovalStatus;
  readonly expectedApprovalRequestId: string | null;
};

export type AdminAccessPendingDecisionUpdate = {
  readonly requestId: string;
  readonly actorId: string;
  readonly nextStatus:
    | typeof StaffAccessRequestStatus.APPROVED
    | typeof StaffAccessRequestStatus.REJECTED;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date;
};

export type AdminAccessRevokedRequestInsert = {
  readonly userId: string;
  readonly actorId: string;
  readonly decidedAt: Date;
};

export type AdminAccessInsertedRequest = {
  readonly id: string;
};

export interface AdminAccessTransactionStore {
  readonly auditLogWriter: UserHistoryTransaction;
  findActorByGithubId(
    githubId: bigint,
    forUpdate?: boolean,
  ): Promise<AdminAccessActor | null>;
  lockActiveAdmins(): Promise<number>;
  findUserForUpdate(userId: string): Promise<AdminAccessUserRow | null>;
  compareAndSwapAccess(input: AdminAccessUserUpdate): Promise<boolean>;
  decidePendingRequest(
    input: AdminAccessPendingDecisionUpdate,
  ): Promise<boolean>;

  insertRevokedRequest(
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest>;
}

export interface AdminAccessRepositoryPort {
  withTransaction<T>(
    operation: (store: AdminAccessTransactionStore) => Promise<T>,
  ): Promise<T>;
  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null>;
  list(
    query: AdminAccessListQuery,
    sortContext?: 'directory' | 'requestQueue',
  ): Promise<AdminAccessUserPageRecord>;
  facets(query: AdminAccessListQuery): Promise<AdminAccessFacets>;
  findById(userId: string): Promise<AdminAccessUserDetailRow | null>;
  listStaffAccessRequestHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessStaffAccessRequestHistoryPage>;
  listLoginHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessLoginHistoryPage>;
}

export type AdminAccessUserSource = Prisma.UserGetPayload<{
  select: AdminAccessReadRepository['ADMIN_ACCESS_USER_SELECT'];
}>;
export type AdminAccessUserDetailSource = Prisma.UserGetPayload<{
  select: AdminAccessReadRepository['ADMIN_ACCESS_USER_DETAIL_SELECT'];
}>;
