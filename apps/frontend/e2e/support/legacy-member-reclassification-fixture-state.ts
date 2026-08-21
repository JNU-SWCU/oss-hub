export type CapturedReclassification = {
  readonly memberKind: 'STUDENT' | 'STAFF';
  readonly name: string;
  readonly studentId?: string;
  readonly affiliationKind: 'DEPARTMENT' | 'PROGRAM_OFFICE';
  readonly affiliationName: string;
};

export type SessionState =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'authenticated';
      readonly role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
      readonly memberKind: 'STUDENT' | 'STAFF' | null;
      readonly hasStaffAccess: boolean;
      readonly hasAdminAccess: boolean;
    };

export type NextResult = 'success' | 'malformed-success' | 'conflict';

export function unresolvedLegacyAdmin(): SessionState {
  return {
    kind: 'authenticated',
    role: 'ADMIN',
    memberKind: null,
    hasStaffAccess: true,
    hasAdminAccess: true,
  };
}

export function resolvedAdmin(
  canonical: CapturedReclassification,
): SessionState {
  return {
    kind: 'authenticated',
    role: 'ADMIN',
    memberKind: canonical.memberKind,
    hasStaffAccess: canonical.memberKind === 'STAFF',
    hasAdminAccess: true,
  };
}

export function authenticatedSession(
  state: Extract<SessionState, { kind: 'authenticated' }>,
) {
  return {
    isAuthenticated: true,
    user: {
      nickname: 'synthetic-legacy-admin',
      name: '합성 기존 관리자',
      email: null,
      avatarUrl: null,
      role: state.role,
      memberKind: state.memberKind,
      hasStaffAccess: state.hasStaffAccess,
      hasAdminAccess: state.hasAdminAccess,
      isProfileComplete: state.memberKind !== null,
    },
  };
}

export function parseReclassificationRequest(
  value: unknown,
): CapturedReclassification {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected reclassification request');
  }
  const record = Object.fromEntries(Object.entries(value));
  const memberKind = parseMemberKind(record.memberKind);
  const affiliationKind = parseAffiliationKind(record.affiliationKind);
  if (
    memberKind === null ||
    affiliationKind === null ||
    typeof record.name !== 'string' ||
    typeof record.affiliationName !== 'string' ||
    (record.studentId !== undefined && typeof record.studentId !== 'string')
  ) {
    throw new TypeError('Invalid reclassification request');
  }
  return {
    memberKind,
    name: record.name,
    affiliationKind,
    affiliationName: record.affiliationName,
    ...(record.studentId === undefined ? {} : { studentId: record.studentId }),
  };
}

function parseMemberKind(
  value: unknown,
): CapturedReclassification['memberKind'] | null {
  if (value === 'STAFF') return 'STAFF';
  if (value === 'STUDENT') return 'STUDENT';
  return null;
}

function parseAffiliationKind(
  value: unknown,
): CapturedReclassification['affiliationKind'] | null {
  if (value === 'PROGRAM_OFFICE') return 'PROGRAM_OFFICE';
  if (value === 'DEPARTMENT') return 'DEPARTMENT';
  return null;
}

export function sameReclassificationRequest(
  left: CapturedReclassification,
  right: CapturedReclassification,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
