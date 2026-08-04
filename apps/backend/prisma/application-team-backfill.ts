/**
 * Application.teamId NULL rows → 1-person Team backfill (D5 stage 2).
 *
 * Run order (fail-closed at each stage):
 *   1. prisma migrate deploy  … 20260804200000_application_require_team_structure
 *   2. pnpm --filter backend db:backfill:application-teams   ← this script
 *   3. prisma migrate deploy  … 20260804201000_application_require_team_not_null
 *
 * Retry strategy:
 *   - Safe to re-run any time. Rows that already have teamId are skipped.
 *   - Each application is processed in its own transaction
 *     (Team → TeamMember(leader) → Application.teamId).
 *   - joinCodeDigest unique collisions retry up to JOIN_CODE_ATTEMPTS
 *     (same bound as ProgramTeamsService.create).
 *   - If a run stops mid-way, fix the reported error and re-run; completed
 *     applications stay linked and are not recreated.
 *   - The script exits non-zero when any teamId NULL remains after the loop
 *     (or when a per-row failure aborts the run).
 *
 * Requires TEAM_JOIN_CODE_SECRET (same secret the runtime uses for join codes).
 * Do not invent digests — join codes are minted with generateJoinCode() and
 * hashed with computeJoinCodeDigest().
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
  computeJoinCodeDigest,
  resolveJoinCodeSecret,
} from '../src/common/join-code-digest';
import { generateJoinCode } from '../src/programs/program-teams.service';

/** Same retry bound as ProgramTeamsService.create. */
export const JOIN_CODE_ATTEMPTS = 5;

export const APPLICATION_TEAM_BACKFILL_ERROR_KIND = {
  JOIN_CODE_RETRIES_EXHAUSTED: 'JOIN_CODE_RETRIES_EXHAUSTED',
  REMAINING_NULL_TEAM: 'REMAINING_NULL_TEAM',
  MEMBERSHIP_CONFLICT: 'MEMBERSHIP_CONFLICT',
} as const;

export type ApplicationTeamBackfillErrorKind =
  (typeof APPLICATION_TEAM_BACKFILL_ERROR_KIND)[keyof typeof APPLICATION_TEAM_BACKFILL_ERROR_KIND];

export class ApplicationTeamBackfillError extends Error {
  constructor(
    readonly kind: ApplicationTeamBackfillErrorKind,
    message: string,
    readonly applicationId?: string,
  ) {
    super(message);
    this.name = 'ApplicationTeamBackfillError';
  }
}

export type ApplicantDisplaySource = {
  readonly id: string;
  readonly name: string | null;
  readonly nickname: string;
  readonly profile: { readonly name: string } | null;
};

/**
 * Prefer profile name → User.name → nickname → stable fallback.
 * Always returns a non-empty, human-readable team name.
 */
export function buildSoloTeamName(applicant: ApplicantDisplaySource): string {
  const profileName = applicant.profile?.name?.trim();
  if (profileName) {
    return `${profileName}의 팀`;
  }
  const legacyName = applicant.name?.trim();
  if (legacyName) {
    return `${legacyName}의 팀`;
  }
  const nickname = applicant.nickname.trim();
  if (nickname) {
    return `${nickname}의 팀`;
  }
  return `참가자 ${applicant.id.slice(0, 8)}의 팀`;
}

export function isJoinCodeDigestUniqueConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const target = error.meta?.target;
  const fields = Array.isArray(target)
    ? target.map(String)
    : typeof target === 'string'
      ? [target]
      : [];
  return fields.some((field) => field.includes('joinCodeDigest'));
}

export type ApplicationTeamBackfillDeps = {
  readonly generateJoinCode: () => string;
  readonly computeJoinCodeDigest: (joinCode: string, secret: string) => string;
  readonly joinCodeSecret: string;
  readonly joinCodeAttempts?: number;
};

export type ApplicationTeamBackfillResult = {
  readonly processed: number;
  readonly skipped: number;
  readonly created: number;
};

type NullTeamApplication = {
  readonly id: string;
  readonly programId: string;
  readonly applicantId: string;
  readonly applicant: ApplicantDisplaySource;
};

async function createSoloTeamForApplication(
  tx: Prisma.TransactionClient,
  application: NullTeamApplication,
  deps: ApplicationTeamBackfillDeps,
): Promise<void> {
  const attempts = deps.joinCodeAttempts ?? JOIN_CODE_ATTEMPTS;
  const teamName = buildSoloTeamName(application.applicant);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const joinCode = deps.generateJoinCode();
    const joinCodeDigest = deps.computeJoinCodeDigest(
      joinCode,
      deps.joinCodeSecret,
    );
    try {
      const team = await tx.team.create({
        data: {
          programId: application.programId,
          name: teamName,
          joinCodeDigest,
          leaderId: application.applicantId,
        },
        select: { id: true },
      });
      await tx.teamMember.create({
        data: {
          teamId: team.id,
          programId: application.programId,
          userId: application.applicantId,
        },
      });
      await tx.application.update({
        where: { id: application.id },
        data: { teamId: team.id },
      });
      return;
    } catch (error) {
      if (isJoinCodeDigestUniqueConflict(error)) {
        continue;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApplicationTeamBackfillError(
          APPLICATION_TEAM_BACKFILL_ERROR_KIND.MEMBERSHIP_CONFLICT,
          `Application ${application.id}: TeamMember unique conflict while minting 1-person team (programId=${application.programId}, userId=${application.applicantId})`,
          application.id,
        );
      }
      throw error;
    }
  }

  throw new ApplicationTeamBackfillError(
    APPLICATION_TEAM_BACKFILL_ERROR_KIND.JOIN_CODE_RETRIES_EXHAUSTED,
    `Application ${application.id}: joinCodeDigest collision retries exhausted after ${attempts} attempts`,
    application.id,
  );
}

export async function backfillApplicationTeams(
  prisma: PrismaClient,
  deps: ApplicationTeamBackfillDeps,
): Promise<ApplicationTeamBackfillResult> {
  // Prisma schema marks teamId non-null (post-D5), but stage-2 DB still allows NULL
  // until the shrink migration. Cast keeps the null filter valid at the type level.
  const nullTeamWhere = {
    teamId: null,
  } as unknown as Prisma.ApplicationWhereInput;

  const pending = await prisma.application.findMany({
    where: nullTeamWhere,
    select: {
      id: true,
      programId: true,
      applicantId: true,
      applicant: {
        select: {
          id: true,
          name: true,
          nickname: true,
          profile: { select: { name: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  let created = 0;
  let skipped = 0;

  for (const application of pending) {
    // Re-check inside the loop so a concurrent writer / prior partial run stays idempotent.
    const current = await prisma.application.findUnique({
      where: { id: application.id },
      select: { teamId: true },
    });
    if (current === null || current.teamId !== null) {
      skipped += 1;
      continue;
    }

    let didCreate = false;
    await prisma.$transaction(async (tx) => {
      // Second guard inside the transaction (lost-update window).
      const locked = await tx.application.findUnique({
        where: { id: application.id },
        select: { teamId: true },
      });
      if (locked === null || locked.teamId !== null) {
        return;
      }
      await createSoloTeamForApplication(tx, application, deps);
      didCreate = true;
    });
    if (didCreate) {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  const remaining = await prisma.application.count({
    where: nullTeamWhere,
  });
  if (remaining > 0) {
    throw new ApplicationTeamBackfillError(
      APPLICATION_TEAM_BACKFILL_ERROR_KIND.REMAINING_NULL_TEAM,
      `Application team backfill incomplete: ${remaining} application row(s) still have teamId NULL`,
    );
  }

  return {
    processed: pending.length,
    skipped,
    created,
  };
}

async function main(): Promise<void> {
  const joinCodeSecret = resolveJoinCodeSecret();
  const prisma = new PrismaClient();
  try {
    const result = await backfillApplicationTeams(prisma, {
      generateJoinCode,
      computeJoinCodeDigest,
      joinCodeSecret,
    });
    console.log(
      `[application-team-backfill] processed=${result.processed} created=${result.created} skipped=${result.skipped}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error('[application-team-backfill] failed:', error);
    process.exitCode = 1;
  });
}
