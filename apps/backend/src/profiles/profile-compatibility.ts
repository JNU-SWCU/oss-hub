import type { Prisma } from '@prisma/client';

export const COMPATIBLE_PROFILE_SELECT = {
  name: true,
  studentId: true,
  department: true,
  profile: {
    select: {
      name: true,
      studentId: true,
      department: true,
    },
  },
} as const satisfies Prisma.UserSelect;

export const COMPATIBLE_PROFILE_NAME_SELECT = {
  name: true,
  profile: { select: { name: true } },
} as const satisfies Prisma.UserSelect;

export type CompatibleProfile = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

export type CompleteCompatibleProfile = {
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
};

export type CompatibleProfileSource = CompatibleProfile & {
  readonly profile: {
    readonly name: string;
    readonly studentId: string;
    readonly department: string;
  } | null;
};

export type CompatibleProfileNameSource = {
  readonly name: string | null;
  readonly profile: { readonly name: string } | null;
};

export function resolveCompatibleProfile(
  source: CompatibleProfileSource,
): CompatibleProfile {
  return (
    source.profile ?? {
      name: source.name,
      studentId: source.studentId,
      department: source.department,
    }
  );
}

export function resolveCompatibleProfileName(
  source: CompatibleProfileNameSource,
): string | null {
  return source.profile?.name ?? source.name;
}

export function compatibleProfileNameWhere(
  query: string,
): Prisma.UserWhereInput {
  const contains = { contains: query, mode: 'insensitive' as const };
  return {
    OR: [
      { profile: { is: { name: contains } } },
      { profile: { is: null }, name: contains },
    ],
  };
}
