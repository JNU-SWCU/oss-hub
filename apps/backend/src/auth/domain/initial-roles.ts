import { MemberKind } from '@prisma/client';

export type InitialAccountSeed = {
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export type InitialAccountSeedMap = ReadonlyMap<bigint, InitialAccountSeed>;

const ENTRY_RE = /^([1-9][0-9]*):(ADMIN|STAFF|STUDENT)$/;

const SEED_BY_SETTING: Record<
  'ADMIN' | 'STAFF' | 'STUDENT',
  InitialAccountSeed
> = {
  STUDENT: {
    memberKind: MemberKind.STUDENT,
    hasStaffAccess: false,
    hasAdminAccess: false,
  },
  STAFF: {
    memberKind: MemberKind.STAFF,
    hasStaffAccess: true,
    hasAdminAccess: false,
  },
  ADMIN: {
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: true,
  },
};

export function parseInitialRoles(
  raw: string | undefined,
): InitialAccountSeedMap {
  if (!raw?.trim()) {
    return new Map();
  }

  const map = new Map<bigint, InitialAccountSeed>();
  for (const piece of raw.split(',')) {
    const entry = piece.trim();
    const match = ENTRY_RE.exec(entry);
    const idRaw = match?.[1];
    const setting = match?.[2] as keyof typeof SEED_BY_SETTING | undefined;
    if (!idRaw || !setting) {
      throw new Error(
        'AUTH_INITIAL_ROLES 항목 형식은 "githubId:ADMIN|STAFF|STUDENT" 입니다.',
      );
    }

    const githubId = BigInt(idRaw);
    if (map.has(githubId)) {
      throw new Error('AUTH_INITIAL_ROLES에 중복된 githubId가 있습니다.');
    }
    map.set(githubId, SEED_BY_SETTING[setting]);
  }
  return map;
}

export function initialAccountSeed(
  setting: 'ADMIN' | 'STAFF' | 'STUDENT',
): InitialAccountSeed {
  return SEED_BY_SETTING[setting];
}
