import {
  CollectionRepositoryPresence,
  Prisma,
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositorySource,
  type RepositoryVisibility,
  type ApplicationStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  RepositoryProvisionLeaseLostError,
  RepositoryProvisionSupersededError,
  GithubRepositoryClaimConflictError,
} from './repository-provision-state.error';
import type { GithubRepositoryMetadata } from './github-app.client';
import { REPOSITORY_CONNECTION_AUDIT_ACTIONS } from '../platform/repository-audit-metadata.config';
import type { RepositoryConnectionAuditMetadata } from '../platform/repository-audit-metadata.config';

export interface ProvisionedRepository {
  readonly id: string;
  readonly applicationId: string;
  readonly githubRepositoryId: bigint;
  readonly name: string;
  readonly url: string;
  readonly visibility: RepositoryVisibility;
}

export interface RepositoryProvisionContext {
  readonly requestId: string;
  readonly requestedConnectionMode: RepositoryConnectionMode;
  readonly requestedRepositoryUrl: string | null;
  readonly requestedByGithubId: bigint | null;
  readonly currentConnectionMode: RepositoryConnectionMode;
  readonly currentRepositoryUrl: string | null;
  readonly applicationId: string;
  readonly applicantGithubId: bigint;
  readonly applicationStatus: ApplicationStatus;
  readonly programId: string;
  readonly programName: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly teamId: string | null;
  readonly subjectName: string;
  readonly repository: ProvisionedRepository | null;

  readonly currentRepositorySource: RepositorySource | null;

  readonly currentMemberGithubLogins: readonly string[];
  readonly membershipFingerprint: string;
}

export interface RepositoryInvitationWork {
  readonly id: string;
  readonly githubLogin: string;
  readonly status: RepositoryInvitationStatus;
  readonly intent: 'GRANT' | 'REVOKE';
}

export interface RecordProvisionedRepositoryInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly requestId: string;
  readonly applicationId: string;
  readonly programId: string;
  readonly teamId: string | null;
  readonly connectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
  readonly currentConnectionMode: RepositoryConnectionMode;
  readonly currentRepositoryUrl: string | null;
  readonly connectionAudit?: RepositoryConnectionAudit;

  readonly source: RepositorySource;
  readonly metadata: GithubRepositoryMetadata;
}

export interface CompleteRepositoryInvitationInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly requestId: string;
  readonly invitationId: string;
  readonly repositoryId: string;
  readonly expectedStatus: RepositoryInvitationStatus;
  readonly status: Extract<
    RepositoryInvitationStatus,
    'PENDING' | 'SUCCEEDED' | 'REVOKED'
  >;
  readonly now: Date;
}

export interface FailRepositoryInvitationInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly requestId: string;
  readonly invitationId: string;
  readonly repositoryId: string;
  readonly expectedStatus: RepositoryInvitationStatus;
  readonly intent: 'GRANT' | 'REVOKE';
  readonly final: boolean;
  readonly errorCode: string;
  readonly now: Date;
}

export interface FailRepositoryProvisionJobInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly requestId: string;
  readonly final: boolean;
  readonly errorCode: string;
  readonly nextAttemptAt: Date;
  readonly now: Date;

  readonly expectedMembershipFingerprint?: string;
}

export interface RepositoryProvisionStateStore {
  loadContext(
    jobId: string,
    workerId: string,
    requestId: string,
  ): Promise<RepositoryProvisionContext>;
  recordRepository(
    input: RecordProvisionedRepositoryInput,
  ): Promise<ProvisionedRepository>;
  prepareInvitations(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
    githubLogins: readonly string[],
  ): Promise<void>;
  findInvitationWork(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
  ): Promise<readonly RepositoryInvitationWork[]>;
  completeInvitation(input: CompleteRepositoryInvitationInput): Promise<void>;
  failInvitation(input: FailRepositoryInvitationInput): Promise<void>;
  recordSupersededRequest(
    applicationId: string,
    requestId: string,
    now: Date,
  ): Promise<void>;
  completeJob(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
    now: Date,
    nextReconciliationAt?: Date,

    expectedMembershipFingerprint?: string,
  ): Promise<void>;
  failJob(input: FailRepositoryProvisionJobInput): Promise<void>;
}

interface LockedRepositoryClaimTarget {
  readonly id: string;
  readonly applicationId: string | null;
  readonly source: RepositorySource;
}

export interface RepositoryConnectionAudit {
  readonly actorGithubId: bigint;
  readonly buildMetadata: (
    change: Omit<RepositoryConnectionAuditMetadata, 'schemaVersion'>,
  ) => RepositoryConnectionAuditMetadata;
}

export interface ProvisionedRepositoryRow {
  readonly id: string;
  readonly applicationId: string | null;
  readonly githubRepositoryId: bigint;
  readonly nameWithOwner: string;
  readonly visibility: RepositoryVisibility;
}

export interface OwnedProvisionedRepositoryRow extends ProvisionedRepositoryRow {
  readonly applicationId: string;
}

export class RepositoryProvisionStateHelpersRepository {
  static assertOwnedRepository(
    row: ProvisionedRepositoryRow,
  ): OwnedProvisionedRepositoryRow {
    if (row.applicationId === null) {
      throw new RepositoryProvisionLeaseLostError();
    }
    return { ...row, applicationId: row.applicationId };
  }

  static claimedJobWhere(jobId: string, workerId: string) {
    return {
      id: jobId,
      status: RepositoryProvisionJobStatus.PROCESSING,
      lockedBy: workerId,
    } as const;
  }

  static async assertProvisionLease(
    transaction: Prisma.TransactionClient | PrismaService,
    jobId: string,
    workerId: string,
  ): Promise<void> {
    const count = await transaction.repositoryProvisionJob.count({
      where: RepositoryProvisionStateHelpersRepository.claimedJobWhere(
        jobId,
        workerId,
      ),
    });
    RepositoryProvisionStateHelpersRepository.assertSingleProvisionUpdate(
      count,
    );
  }

  static async assertCurrentRequest(
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

  static assertSingleProvisionUpdate(count: number): void {
    if (count !== 1) {
      throw new RepositoryProvisionLeaseLostError();
    }
  }

  static isPrismaUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  static async lockApplicationForRepositoryClaim(
    transaction: Prisma.TransactionClient,
    applicationId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<
      readonly { readonly id: string }[]
    >(
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

  static async claimGithubRepositoryForApplication(
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
      readonly connectionAudit?: RepositoryConnectionAudit;
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
          select: RepositoryProvisionStateHelpersRepository.repositorySelection,
        });
      } catch (error) {
        if (
          RepositoryProvisionStateHelpersRepository.isPrismaUniqueConstraintError(
            error,
          )
        ) {
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
        select: RepositoryProvisionStateHelpersRepository.repositorySelection,
      });
    }

    await transaction.application.update({
      where: { id: input.applicationId },
      data: {
        repositoryConnectionMode: input.connectionMode,
        repositoryUrl: input.repositoryUrl,
      },
    });
    if (input.connectionAudit !== undefined) {
      const auditActor = await transaction.user.findUniqueOrThrow({
        where: { githubId: input.connectionAudit.actorGithubId },
        select: { id: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: auditActor.id,
          action:
            REPOSITORY_CONNECTION_AUDIT_ACTIONS.REPOSITORY_CONNECTION_CHANGED,
          targetType: 'APPLICATION',
          targetId: input.applicationId,
          metadata: input.connectionAudit.buildMetadata({
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

  static async lockClaimedProvisionJob(
    transaction: Prisma.TransactionClient,
    jobId: string,
    workerId: string,
    expectedRequestId: string,
  ): Promise<{
    readonly applicationId: string;
    readonly repositoryId: string | null;
  }> {
    return RepositoryProvisionStateHelpersRepository.assertCurrentRequest(
      transaction,
      jobId,
      workerId,
      expectedRequestId,
    );
  }

  static matchesProvisionedMetadata(
    repository: OwnedProvisionedRepositoryRow,
    input: RecordProvisionedRepositoryInput,
  ): boolean {
    return (
      repository.applicationId === input.applicationId &&
      repository.githubRepositoryId === input.metadata.githubRepositoryId &&
      repository.nameWithOwner === input.metadata.nameWithOwner &&
      repository.visibility === input.metadata.visibility
    );
  }

  static readonly repositorySelection = {
    id: true,
    applicationId: true,
    githubRepositoryId: true,
    nameWithOwner: true,
    visibility: true,
  } as const;

  static readonly teamMemberLoginSelection = {
    user: { select: { nickname: true } },
  } as const;
}
