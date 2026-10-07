import {
  CollectionRepositoryPresence,
  Prisma,
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositorySource,
} from '@prisma/client';
import type { RepositoryVisibility } from '@prisma/client';
import {
  createRepositoryConnectionAuditMetadata,
  REPOSITORY_CONNECTION_AUDIT_ACTIONS,
} from '../audit-log/audit-log-metadata';
import { PrismaService } from '../prisma/prisma.service';
import {
  repositoryNameFromNameWithOwner,
  repositoryUrlFromNameWithOwner,
} from './repository-identity';
import {
  canonicalGithubLogin,
  canonicalGithubLogins,
} from './repository-provision-event';
import type { GithubRepositoryMetadata } from './github-app.client';
import type {
  ProvisionedRepository,
  RecordProvisionedRepositoryInput,
} from './repository-provision.contract';

export class RepositoryProvisionLeaseLostError extends Error {
  override readonly name = 'RepositoryProvisionLeaseLostError';
}

export class RepositoryProvisionSupersededError extends Error {
  override readonly name = 'RepositoryProvisionSupersededError';

  constructor(readonly staleRequestId: string) {
    super('Repository provision request was superseded');
  }
}

export class GithubRepositoryClaimConflictError extends Error {
  override readonly name = 'GithubRepositoryClaimConflictError';
}

interface LockedRepositoryClaimTarget {
  readonly id: string;
  readonly applicationId: string | null;
  readonly source: RepositorySource;
}

export const repositorySelection = {
  id: true,
  applicationId: true,
  githubRepositoryId: true,
  nameWithOwner: true,
  visibility: true,
} as const;

export interface ProvisionedRepositoryRow {
  readonly id: string;
  readonly applicationId: string | null;
  readonly githubRepositoryId: bigint;
  readonly nameWithOwner: string;
  readonly visibility: RepositoryVisibility;
}

export function toProvisionedRepository(
  row: ProvisionedRepositoryRow,
): ProvisionedRepository {
  if (row.applicationId === null) {
    throw new RepositoryProvisionLeaseLostError();
  }
  return {
    id: row.id,
    applicationId: row.applicationId,
    githubRepositoryId: row.githubRepositoryId,
    name: repositoryNameFromNameWithOwner(row.nameWithOwner),
    url: repositoryUrlFromNameWithOwner(row.nameWithOwner),
    visibility: row.visibility,
  };
}

export function claimedJobWhere(jobId: string, workerId: string) {
  return {
    id: jobId,
    status: RepositoryProvisionJobStatus.PROCESSING,
    lockedBy: workerId,
  } as const;
}

export async function assertProvisionLease(
  transaction: Prisma.TransactionClient | PrismaService,
  jobId: string,
  workerId: string,
): Promise<void> {
  const count = await transaction.repositoryProvisionJob.count({
    where: claimedJobWhere(jobId, workerId),
  });
  assertSingleProvisionUpdate(count);
}

export async function assertCurrentRequest(
  transaction: Prisma.TransactionClient,
  jobId: string,
  workerId: string,
  expectedRequestId: string,
): Promise<{
  readonly applicationId: string;
  readonly repositoryId: string | null;
}> {
  const rows = await transaction.$queryRaw<
    readonly {
      readonly applicationId: string;
      readonly currentEventId: string | null;
      readonly repositoryId: string | null;
      readonly status: RepositoryProvisionJobStatus;
      readonly lockedBy: string | null;
    }[]
  >(Prisma.sql`
    SELECT "applicationId", "currentEventId", "repositoryId", "status", "lockedBy"
    FROM "RepositoryProvisionJob"
    WHERE "id" = ${jobId}
    FOR UPDATE
  `);
  const row = rows[0];
  if (row === undefined) {
    throw new RepositoryProvisionLeaseLostError();
  }
  if (row.currentEventId !== expectedRequestId) {
    throw new RepositoryProvisionSupersededError(expectedRequestId);
  }
  if (
    row.status !== RepositoryProvisionJobStatus.PROCESSING ||
    row.lockedBy !== workerId
  ) {
    throw new RepositoryProvisionLeaseLostError();
  }
  return {
    applicationId: row.applicationId,
    repositoryId: row.repositoryId,
  };
}

export function assertSingleProvisionUpdate(count: number): void {
  if (count !== 1) {
    throw new RepositoryProvisionLeaseLostError();
  }
}

export function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export async function lockApplicationForRepositoryClaim(
  transaction: Prisma.TransactionClient,
  applicationId: string,
): Promise<void> {
  const rows = await transaction.$queryRaw<readonly { readonly id: string }[]>(
    Prisma.sql`
      SELECT "id"
      FROM "Application"
      WHERE "id" = ${applicationId}
      FOR UPDATE
    `,
  );
  if (rows.length !== 1) {
    throw new GithubRepositoryClaimConflictError();
  }
}

export async function claimGithubRepositoryForApplication(
  transaction: Prisma.TransactionClient,
  input: {
    readonly applicationId: string;
    readonly programId: string;
    readonly teamId: string | null;
    readonly metadata: GithubRepositoryMetadata;
    readonly source: RepositorySource;
    readonly currentConnectionMode: RepositoryConnectionMode;
    readonly currentRepositoryUrl: string | null;
    readonly connectionMode: RepositoryConnectionMode;
    readonly repositoryUrl: string | null;
    readonly auditActorGithubId?: bigint;
  },
): Promise<ProvisionedRepositoryRow> {
  const target =
    (
      await transaction.$queryRaw<readonly LockedRepositoryClaimTarget[]>(
        Prisma.sql`
          SELECT "id", "applicationId", "source"
          FROM "GithubRepository"
          WHERE "githubRepositoryId" = ${input.metadata.githubRepositoryId}
          FOR UPDATE
        `,
      )
    )[0] ?? null;
  if (
    target !== null &&
    target.applicationId !== null &&
    target.applicationId !== input.applicationId
  ) {
    throw new GithubRepositoryClaimConflictError();
  }

  const current = await transaction.githubRepository.findUnique({
    where: { applicationId: input.applicationId },
    select: { id: true, nameWithOwner: true },
  });
  if (current !== null && current.id !== target?.id) {
    await transaction.githubRepository.update({
      where: { id: current.id },
      data: { applicationId: null, publishedAt: null },
    });
  }

  const source =
    target?.source === RepositorySource.ORG_PROVISIONED
      ? RepositorySource.ORG_PROVISIONED
      : input.source;
  let repository: ProvisionedRepositoryRow;
  if (target === null) {
    try {
      repository = await transaction.githubRepository.create({
        data: {
          applicationId: input.applicationId,
          programId: input.programId,
          teamId: input.teamId,
          githubRepositoryId: input.metadata.githubRepositoryId,
          nameWithOwner: input.metadata.nameWithOwner,
          visibility: input.metadata.visibility,
          source,
          presence: CollectionRepositoryPresence.PRESENT,
        },
        select: repositorySelection,
      });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new GithubRepositoryClaimConflictError();
      }
      throw error;
    }
  } else {
    const claimed = await transaction.githubRepository.updateMany({
      where: {
        id: target.id,
        OR: [{ applicationId: null }, { applicationId: input.applicationId }],
      },
      data: {
        applicationId: input.applicationId,
        programId: input.programId,
        teamId: input.teamId,
        nameWithOwner: input.metadata.nameWithOwner,
        visibility: input.metadata.visibility,
        source,
        presence: CollectionRepositoryPresence.PRESENT,
      },
    });
    if (claimed.count !== 1) {
      throw new GithubRepositoryClaimConflictError();
    }
    repository = await transaction.githubRepository.findUniqueOrThrow({
      where: { id: target.id },
      select: repositorySelection,
    });
  }

  await transaction.application.update({
    where: { id: input.applicationId },
    data: {
      repositoryConnectionMode: input.connectionMode,
      repositoryUrl: input.repositoryUrl,
    },
  });
  if (input.auditActorGithubId !== undefined) {
    const auditActor = await transaction.user.findUniqueOrThrow({
      where: { githubId: input.auditActorGithubId },
      select: { id: true },
    });
    await transaction.auditLog.create({
      data: {
        actorId: auditActor.id,
        action:
          REPOSITORY_CONNECTION_AUDIT_ACTIONS.REPOSITORY_CONNECTION_CHANGED,
        targetType: 'APPLICATION',
        targetId: input.applicationId,
        metadata: createRepositoryConnectionAuditMetadata({
          applicationId: input.applicationId,
          before: {
            repositoryId: current?.id ?? null,
            nameWithOwner: current?.nameWithOwner ?? null,

            connectionMode: input.currentConnectionMode,
            repositoryUrl: input.currentRepositoryUrl,
          },
          after: {
            repositoryId: repository.id,
            nameWithOwner: repository.nameWithOwner,
            connectionMode: input.connectionMode,
            repositoryUrl: input.repositoryUrl,
          },
        }),
      },
    });
  }
  return repository;
}

export const PROVISION_MEMBERSHIP_UNAVAILABLE_ERROR_CODE =
  'REPOSITORY_PROVISION_MEMBERSHIP_UNAVAILABLE';

export const REVOCATION_INVITATION_STATUSES = [
  RepositoryInvitationStatus.REVOKE_REQUIRED,
  RepositoryInvitationStatus.REVOKED,
  RepositoryInvitationStatus.REVOKE_FAILED_RETRYABLE,
  RepositoryInvitationStatus.REVOKE_FAILED_FINAL,
] as const;

export function invitationIntent(
  status: RepositoryInvitationStatus,
): 'GRANT' | 'REVOKE' {
  return (
    REVOCATION_INVITATION_STATUSES as readonly RepositoryInvitationStatus[]
  ).includes(status)
    ? 'REVOKE'
    : 'GRANT';
}

export { canonicalGithubLogin, canonicalGithubLogins };

export function membershipFingerprint(logins: readonly string[]): string {
  return JSON.stringify(logins);
}

export const teamMemberLoginSelection = {
  user: { select: { nickname: true } },
} as const;

export function loginsFromTeamMembers(
  members: readonly { readonly user: { readonly nickname: string } }[],
): readonly string[] {
  return canonicalGithubLogins(members.map((member) => member.user.nickname));
}

export async function lockClaimedProvisionJob(
  transaction: Prisma.TransactionClient,
  jobId: string,
  workerId: string,
  expectedRequestId: string,
): Promise<{
  readonly applicationId: string;
  readonly repositoryId: string | null;
}> {
  return assertCurrentRequest(transaction, jobId, workerId, expectedRequestId);
}

export function matchesProvisionedMetadata(
  repository: ProvisionedRepository,
  input: RecordProvisionedRepositoryInput,
): boolean {
  return (
    repository.applicationId === input.applicationId &&
    repository.githubRepositoryId === input.metadata.githubRepositoryId &&
    repository.name === input.metadata.name &&
    repository.url === input.metadata.url &&
    repository.visibility === input.metadata.visibility
  );
}
