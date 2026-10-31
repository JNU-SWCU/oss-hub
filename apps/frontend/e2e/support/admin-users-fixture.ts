export type SyntheticRole = 'STUDENT' | 'STAFF' | 'ADMIN';
export type SyntheticMemberKind = 'STUDENT' | 'STAFF';
type SyntheticAccountStatus = 'ACTIVE' | 'DEACTIVATED';

interface SyntheticPendingRequest {
  readonly id: string;
  readonly status: 'PENDING';
  readonly createdAt: string;
}

interface SyntheticAuthorityFields {
  readonly memberKind: SyntheticMemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
}

export interface SyntheticAdminUserRow extends SyntheticAuthorityFields {
  readonly id: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly role: SyntheticRole | null;
  readonly accountStatus: SyntheticAccountStatus;
  readonly isSelf: boolean;
  readonly isProfileComplete: boolean;
  readonly createdAt: string;
  readonly pendingRequest: SyntheticPendingRequest | null;
  readonly lastLoginAt: string | null;
}

interface SyntheticAdminUserProfile {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly staffNumber: string | null;
  readonly isComplete: boolean;
}

export interface SyntheticAdminUserDetail extends SyntheticAdminUserRow {
  readonly profile: SyntheticAdminUserProfile;
}

interface SyntheticFacetCounts {
  readonly roles: {
    readonly unassigned: number;
    readonly student: number;
    readonly staff: number;
    readonly admin: number;
  };
  readonly accountStatuses: {
    readonly active: number;
    readonly deactivated: number;
  };
  readonly pendingRequests: {
    readonly none: number;
    readonly pending: number;
  };
}

export interface SyntheticAdminUsersListPage {
  readonly items: readonly SyntheticAdminUserRow[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly facets: SyntheticFacetCounts;
}

export interface SyntheticAdminUserHistory {
  readonly staffAccessRequests: {
    readonly items: readonly {
      readonly id: string;
      readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
      readonly rejectionReason: string | null;
      readonly decidedAt: string | null;
      readonly decidedBy: string | null;
      readonly createdAt: string;
    }[];
    readonly page: number;
    readonly limit: number;
    readonly total: number;
  };
  readonly loginHistory: {
    readonly items: readonly {
      readonly id: string;
      readonly event: 'LOGIN' | 'LOGOUT';
      readonly provider: 'github';
      readonly success: boolean;
      readonly loginAt: string;
    }[];
    readonly page: number;
    readonly limit: number;
    readonly total: number;
  };
}

export const SYNTHETIC_SELF = {
  githubLogin: 'synthetic-member-access',
  name: '합성 권한 사용자',
} as const;

const ADMIN_USERS_PAGE_LIMIT = 20;
const ADMIN_USERS_TOTAL = 41;

function authorityFor(role: SyntheticRole | null): SyntheticAuthorityFields {
  switch (role) {
    case 'ADMIN':
      return {
        memberKind: 'STAFF',
        hasStaffAccess: true,
        hasAdminAccess: true,
      };
    case 'STAFF':
      return {
        memberKind: 'STAFF',
        hasStaffAccess: true,
        hasAdminAccess: false,
      };
    case 'STUDENT':
      return {
        memberKind: 'STUDENT',
        hasStaffAccess: false,
        hasAdminAccess: false,
      };
    case null:
      return { memberKind: null, hasStaffAccess: false, hasAdminAccess: false };
  }
}

interface RowSeed {
  readonly n: number;
  readonly role: SyntheticRole | null;
  readonly accountStatus?: SyntheticAccountStatus;
  readonly isProfileComplete?: boolean;
  readonly nameless?: boolean;
  readonly pendingRequestAt?: string;
  readonly createdAt: string;
  readonly lastLoginAt: string | null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function row(seed: RowSeed): SyntheticAdminUserRow {
  return {
    id: `synthetic-id-${pad(seed.n)}`,
    githubLogin: `synthetic-user-${pad(seed.n)}`,
    name: seed.nameless ? null : `합성 사용자 ${pad(seed.n)}`,
    role: seed.role,
    accountStatus: seed.accountStatus ?? 'ACTIVE',
    isSelf: false,
    isProfileComplete: seed.isProfileComplete ?? true,
    createdAt: seed.createdAt,
    pendingRequest: seed.pendingRequestAt
      ? {
          id: `synthetic-request-${pad(seed.n)}`,
          status: 'PENDING',
          createdAt: seed.pendingRequestAt,
        }
      : null,
    lastLoginAt: seed.lastLoginAt,
    ...authorityFor(seed.role),
  };
}

const SELF_ROW: SyntheticAdminUserRow = {
  id: 'synthetic-id-self',
  githubLogin: SYNTHETIC_SELF.githubLogin,
  name: SYNTHETIC_SELF.name,
  role: 'ADMIN',
  accountStatus: 'ACTIVE',
  isSelf: true,
  isProfileComplete: true,
  createdAt: '2025-03-03T00:30:00.000Z',
  pendingRequest: null,
  lastLoginAt: '2026-10-31T07:45:00.000Z',
  ...authorityFor('ADMIN'),
};

export const adminUsersPage1Rows: readonly SyntheticAdminUserRow[] = [
  SELF_ROW,
  row({
    n: 1,
    role: 'STUDENT',
    createdAt: '2026-03-02T01:12:00.000Z',
    lastLoginAt: '2026-10-30T13:20:00.000Z',
  }),
  row({
    n: 2,
    role: 'ADMIN',
    createdAt: '2025-02-17T05:00:00.000Z',
    lastLoginAt: '2026-10-29T02:05:00.000Z',
  }),
  row({
    n: 3,
    role: 'STUDENT',
    createdAt: '2026-03-04T08:41:00.000Z',
    lastLoginAt: '2026-10-28T11:30:00.000Z',
  }),
  row({
    n: 4,
    role: 'STAFF',
    createdAt: '2025-08-19T06:10:00.000Z',
    lastLoginAt: '2026-10-30T00:55:00.000Z',
  }),
  row({
    n: 5,
    role: 'STUDENT',
    pendingRequestAt: '2026-10-27T04:15:00.000Z',
    createdAt: '2026-03-05T02:30:00.000Z',
    lastLoginAt: '2026-10-27T04:10:00.000Z',
  }),
  row({
    n: 6,
    role: 'STUDENT',
    createdAt: '2026-03-06T09:05:00.000Z',
    lastLoginAt: '2026-10-25T14:00:00.000Z',
  }),
  row({
    n: 7,
    role: 'STUDENT',
    nameless: true,
    isProfileComplete: false,
    createdAt: '2026-10-29T10:20:00.000Z',
    lastLoginAt: '2026-10-29T10:21:00.000Z',
  }),
  row({
    n: 8,
    role: 'STAFF',
    createdAt: '2025-09-01T01:00:00.000Z',
    lastLoginAt: '2026-10-24T07:40:00.000Z',
  }),
  row({
    n: 9,
    role: 'STUDENT',
    accountStatus: 'DEACTIVATED',
    createdAt: '2025-03-10T03:00:00.000Z',
    lastLoginAt: '2025-12-20T09:00:00.000Z',
  }),
  row({
    n: 10,
    role: 'STUDENT',
    createdAt: '2026-03-09T07:25:00.000Z',
    lastLoginAt: null,
  }),
  row({
    n: 11,
    role: null,
    createdAt: '2026-10-28T06:00:00.000Z',
    lastLoginAt: '2026-10-28T06:02:00.000Z',
  }),
  row({
    n: 12,
    role: 'STAFF',
    createdAt: '2025-09-15T02:45:00.000Z',
    lastLoginAt: '2026-10-30T09:10:00.000Z',
  }),
  row({
    n: 13,
    role: 'STUDENT',
    createdAt: '2026-03-11T05:50:00.000Z',
    lastLoginAt: '2026-10-21T12:35:00.000Z',
  }),
  row({
    n: 14,
    role: 'STUDENT',
    createdAt: '2026-03-12T01:05:00.000Z',
    lastLoginAt: '2026-10-19T03:15:00.000Z',
  }),
  row({
    n: 15,
    role: 'ADMIN',
    createdAt: '2025-01-20T04:30:00.000Z',
    lastLoginAt: '2026-10-31T01:00:00.000Z',
  }),
  row({
    n: 16,
    role: 'STAFF',
    createdAt: '2025-10-02T08:00:00.000Z',
    lastLoginAt: '2026-10-22T05:45:00.000Z',
  }),
  row({
    n: 17,
    role: 'STUDENT',
    createdAt: '2026-03-13T10:40:00.000Z',
    lastLoginAt: null,
  }),
  row({
    n: 18,
    role: 'STAFF',
    createdAt: '2025-10-20T03:20:00.000Z',
    lastLoginAt: '2026-10-30T15:30:00.000Z',
  }),
  row({
    n: 19,
    role: 'STUDENT',
    createdAt: '2026-03-16T06:15:00.000Z',
    lastLoginAt: '2026-10-26T08:50:00.000Z',
  }),
];

const adminUsersFacets: SyntheticFacetCounts = {
  roles: { unassigned: 2, student: 27, staff: 8, admin: 4 },
  accountStatuses: { active: 39, deactivated: 2 },
  pendingRequests: { none: 38, pending: 3 },
};

export const adminUsersListPage: SyntheticAdminUsersListPage = {
  items: adminUsersPage1Rows,
  page: 1,
  limit: ADMIN_USERS_PAGE_LIMIT,
  total: ADMIN_USERS_TOTAL,
  facets: adminUsersFacets,
};

function profileFor(item: SyntheticAdminUserRow): SyntheticAdminUserProfile {
  if (item.name === null || !item.isProfileComplete) {
    return {
      name: null,
      studentId: null,
      department: null,
      staffNumber: null,
      isComplete: false,
    };
  }
  const serial = item.id.replace(/\D/g, '').padStart(2, '0');
  return item.memberKind === 'STUDENT'
    ? {
        name: item.name,
        studentId: `2026${serial.padStart(5, '0')}`,
        department: '합성 학과',
        staffNumber: null,
        isComplete: true,
      }
    : {
        name: item.name,
        studentId: null,
        department: '합성 부서',
        staffNumber: null,
        isComplete: true,
      };
}

export const adminUsersDetailById: Readonly<
  Record<string, SyntheticAdminUserDetail>
> = Object.fromEntries(
  adminUsersPage1Rows.map((item) => [
    item.id,
    { ...item, profile: profileFor(item) },
  ]),
);

export function adminUserHistoryFor(
  item: SyntheticAdminUserRow,
): SyntheticAdminUserHistory {
  return {
    staffAccessRequests: {
      items: item.pendingRequest
        ? [
            {
              id: item.pendingRequest.id,
              status: 'PENDING',
              rejectionReason: null,
              decidedAt: null,
              decidedBy: null,
              createdAt: item.pendingRequest.createdAt,
            },
          ]
        : [],
      page: 1,
      limit: 10,
      total: item.pendingRequest ? 1 : 0,
    },
    loginHistory: {
      items: item.lastLoginAt
        ? [
            {
              id: `${item.id}-login-1`,
              event: 'LOGIN',
              provider: 'github',
              success: true,
              loginAt: item.lastLoginAt,
            },
          ]
        : [],
      page: 1,
      limit: 10,
      total: item.lastLoginAt ? 1 : 0,
    },
  };
}
