import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { memberAuthorityAggregate } from './member-authority-backfill-aggregate';
import {
  applyMemberAuthorityBackfill,
  MemberAuthorityBackfillInvariantError,
} from './member-authority-backfill-core';
import { runMemberAuthorityFixture } from './member-authority-backfill-fixture';
import {
  MEMBER_AUTHORITY_BACKFILL_VERSION,
  type MemberAuthorityBackfillUser,
  type MemberAuthorityRequestSnapshot,
} from './member-authority-backfill-types';

const USER_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  role: true,
  selectedRole: true,
  selectedMemberKind: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  name: true,
  studentId: true,
  department: true,
  profile: {
    select: {
      name: true,
      studentId: true,
      department: true,
      memberKind: true,
      affiliationKind: true,
      affiliationName: true,
    },
  },
} as const satisfies Prisma.UserSelect;

const REQUEST_SELECT = {
  id: true,
  userId: true,
  status: true,
  decidedById: true,
} as const satisfies Prisma.RoleRequestSelect;

type BackfillTransaction = Pick<
  Prisma.TransactionClient,
  'user' | 'userProfile' | 'roleRequest'
>;

export type BackfillMemberAuthorityOptions = {
  readonly userIdPrefix?: string;
};

export async function backfillMemberAuthority(
  prisma: PrismaClient,
  options: BackfillMemberAuthorityOptions = {},
) {
  return prisma.$transaction(
    async (transaction) => {
      const before = await loadState(transaction, options.userIdPrefix);
      const result = applyMemberAuthorityBackfill(before.users);
      for (const [index, current] of before.users.entries()) {
        const next = result.users[index];
        if (next === undefined || unchanged(current, next)) continue;
        await transaction.user.update({
          where: { id: current.id },
          data: {
            selectedMemberKind: next.selectedMemberKind,
            name: next.name,
            studentId: next.studentId,
            department: next.department,
            hasStaffAccess: next.hasStaffAccess,
            hasAdminAccess: next.hasAdminAccess,
          },
        });
        if (next.profile !== null) {
          await transaction.userProfile.upsert({
            where: { userId: current.id },
            create: { userId: current.id, ...next.profile },
            update: next.profile,
          });
        }
      }
      const after = await loadState(transaction, options.userIdPrefix);
      return {
        version: MEMBER_AUTHORITY_BACKFILL_VERSION,
        changedUsers: result.changedUsers,
        changedProfiles: result.changedProfiles,
        createdProfiles: result.createdProfiles,
        clearedNonStudentIds: result.clearedNonStudentIds,
        before: memberAuthorityAggregate(before.users, before.requests),
        after: memberAuthorityAggregate(after.users, after.requests),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function readMemberAuthorityStatus(
  prisma: PrismaClient,
  options: BackfillMemberAuthorityOptions = {},
) {
  const state = await loadState(prisma, options.userIdPrefix);
  const expected = applyMemberAuthorityBackfill(state.users);
  return {
    version: MEMBER_AUTHORITY_BACKFILL_VERSION,
    aggregate: memberAuthorityAggregate(state.users, state.requests),
    expected: {
      changedUsers: expected.changedUsers,
      changedProfiles: expected.changedProfiles,
      createdProfiles: expected.createdProfiles,
      clearedNonStudentIds: expected.clearedNonStudentIds,
      aggregate: memberAuthorityAggregate(expected.users, state.requests),
    },
  };
}

async function loadState(
  store: BackfillTransaction | PrismaClient,
  userIdPrefix?: string,
): Promise<{
  readonly users: readonly MemberAuthorityBackfillUser[];
  readonly requests: readonly MemberAuthorityRequestSnapshot[];
}> {
  const [users, requests] = await Promise.all([
    store.user.findMany({
      where:
        userIdPrefix === undefined
          ? undefined
          : { id: { startsWith: userIdPrefix } },
      select: USER_SELECT,
      orderBy: { id: 'asc' },
    }),
    store.roleRequest.findMany({
      where:
        userIdPrefix === undefined
          ? undefined
          : { userId: { startsWith: userIdPrefix } },
      select: REQUEST_SELECT,
      orderBy: { id: 'asc' },
    }),
  ]);
  return {
    users: users.map((user) => ({
      ...user,
      githubId: user.githubId.toString(),
    })),
    requests,
  };
}

function unchanged(
  before: MemberAuthorityBackfillUser,
  after: MemberAuthorityBackfillUser,
): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

type CliMode =
  | {
      readonly kind: 'fixture';
      readonly fixture: string;
      readonly evidence: string;
    }
  | { readonly kind: 'apply'; readonly evidence: string | null }
  | { readonly kind: 'status'; readonly evidence: string | null };

function parseArgs(rawArgs: readonly string[]): CliMode {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  const evidenceIndex = args.indexOf('--evidence');
  const evidence =
    evidenceIndex < 0 ? null : (args[evidenceIndex + 1] ?? usage());
  if (
    args[0] === '--fixture' &&
    args[1] !== undefined &&
    args.length === 4 &&
    evidence !== null
  ) {
    return { kind: 'fixture', fixture: args[1], evidence };
  }
  if (args[0] === '--apply-production' && args.length <= 3) {
    return { kind: 'apply', evidence };
  }
  if (args[0] === '--status-production' && args.length <= 3) {
    return { kind: 'status', evidence };
  }
  return usage();
}

function usage(): never {
  throw new TypeError(
    'Usage: member-authority-backfill (--fixture <json> --evidence <json> | --apply-production [--evidence <json>] | --status-production [--evidence <json>])',
  );
}

async function emit(value: unknown, evidence: string | null): Promise<void> {
  const serialized = `${JSON.stringify(value)}\n`;
  if (evidence === null || evidence === '-') {
    process.stdout.write(serialized);
    return;
  }
  await writeFile(evidence, serialized, { encoding: 'utf8', mode: 0o600 });
}

async function main(): Promise<void> {
  const mode = parseArgs(process.argv.slice(2));
  if (mode.kind === 'fixture') {
    const input: unknown = JSON.parse(
      await readFile(resolveCliPath(mode.fixture), 'utf8'),
    );
    await emit(runMemberAuthorityFixture(input), resolveCliPath(mode.evidence));
    return;
  }
  const prisma = new PrismaClient();
  try {
    const result =
      mode.kind === 'apply'
        ? await backfillMemberAuthority(prisma)
        : await readMemberAuthorityStatus(prisma);
    await emit(
      result,
      mode.evidence === null ? null : resolveCliPath(mode.evidence),
    );
  } finally {
    await prisma.$disconnect();
  }
}

function resolveCliPath(path: string): string {
  if (path === '-' || isAbsolute(path)) return path;
  const cwd = process.cwd();
  const root =
    basename(cwd) === 'backend' && basename(dirname(cwd)) === 'apps'
      ? resolve(cwd, '../..')
      : cwd;
  return resolve(root, path);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `[member-authority-backfill] failed ${failureDetail(error)}\n`,
    );
    process.exitCode = 1;
  });
}

function failureDetail(error: unknown): string {
  if (error instanceof MemberAuthorityBackfillInvariantError) {
    return `kind=${error.kind} count=${error.affectedCount}`;
  }
  if (error instanceof Error) return `kind=${error.name}`;
  return 'kind=UnknownError';
}
