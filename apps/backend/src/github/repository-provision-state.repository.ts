import { Injectable } from '@nestjs/common';
import { RepositoryDeletionRepository } from '../platform/repository-deletion.repository';
import {
  CollectionRepositoryPresence,
  Prisma,
  RepositoryConnectionMode,
  RepositoryIssuanceOutcome,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositorySource,
  type RepositoryVisibility,
  type ApplicationStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  RepositoryProvisionGenerationRepository,
  type RepositoryProvisionHistoryPayloadParser,
} from '../platform/repository-provision-generation.repository';
import { RepositoryProvisionJobRepository } from './repository-provision-job.repository';
import type { GithubRepositoryMetadata } from './github-app.client';
import {
  DEFAULT_PROVISION_MAX_INVITATION_RECONCILIATIONS,
  PROVISION_ERROR_CODES,
} from './repository-provision-state.config';
import {
  GithubRepositoryClaimConflictError,
  RepositoryProvisionLeaseLostError,
  RepositoryProvisionFailure,
} from './repository-provision-state.error';

export interface ProvisionedRepository {
  readonly id: string;
  readonly teamId: string;
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
  readonly teamId: string;
  readonly applicantGithubId: bigint;
  readonly applicationStatus: ApplicationStatus;
  readonly programId: string;
  readonly programName: string;
  readonly repositoryProvisioningEnabled: boolean;
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
  readonly teamId: string;
  readonly programId: string;
  readonly connectionMode: RepositoryConnectionMode;
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
    teamId: string,
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
  readonly teamId: string | null;
  readonly source: RepositorySource;
}

export interface RepositoryConnectionAudit {
  readonly actorGithubId: bigint;
}

export interface ProvisionedRepositoryRow {
  readonly id: string;
  readonly teamId: string | null;
  readonly githubRepositoryId: bigint;
  readonly nameWithOwner: string;
  readonly visibility: RepositoryVisibility;
}

export interface OwnedProvisionedRepositoryRow extends ProvisionedRepositoryRow {
  readonly teamId: string;
}

function failedInvitationStatus(
  input: FailRepositoryInvitationInput,
): RepositoryInvitationStatus {
  if (input.intent === 'REVOKE') {
    return input.final
      ? RepositoryInvitationStatus.REVOKE_FAILED_FINAL
      : RepositoryInvitationStatus.REVOKE_FAILED_RETRYABLE;
  }
  return input.final
    ? RepositoryInvitationStatus.FAILED_FINAL
    : RepositoryInvitationStatus.FAILED_RETRYABLE;
}

function rearmedProvisionJobData(
  now: Date,
  repositoryId?: string,
): Prisma.RepositoryProvisionJobUncheckedUpdateManyInput {
  return {
    ...(repositoryId === undefined ? {} : { repositoryId }),
    status: RepositoryProvisionJobStatus.PENDING,
    attemptCount: 0,
    nextAttemptAt: now,
    lockedAt: null,
    lockedBy: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    finishedAt: null,
  };
}

export interface RepositoryInvitationRow {
  readonly id: string;
  readonly githubLogin: string;
  readonly status: RepositoryInvitationStatus;
}

export type MembershipCurrencyCheck = (
  memberLogins: readonly string[],
) => boolean;

@Injectable()
export class RepositoryProvisionStateRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repositoryProvisionGenerationRepository: RepositoryProvisionGenerationRepository,
    private readonly repositoryProvisionJobRepository: RepositoryProvisionJobRepository,
    private readonly repositoryDeletion: RepositoryDeletionRepository,
  ) {}

  assertOwnedRepository(
    row: ProvisionedRepositoryRow,
  ): OwnedProvisionedRepositoryRow {
    if (row.teamId === null) {
      throw new RepositoryProvisionLeaseLostError();
    }
    return { ...row, teamId: row.teamId };
  }

  private isPrismaUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private async lockApplicationForRepositoryClaim(
    transaction: Prisma.TransactionClient,
    teamId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<
      readonly { readonly id: string }[]
    >(
      Prisma.sql`
      SELECT "id"
      FROM "Team"
      WHERE "id" = ${teamId}
      FOR UPDATE
    `,
    );
    if (rows.length !== 1) {
      throw new GithubRepositoryClaimConflictError();
    }
  }

  private async claimGithubRepositoryForApplication(
    transaction: Prisma.TransactionClient,
    input: {
      readonly teamId: string;
      readonly metadata: GithubRepositoryMetadata;
      readonly source: RepositorySource;
      readonly connectionMode: RepositoryConnectionMode;
      readonly connectionAudit?: RepositoryConnectionAudit;
    },
  ): Promise<ProvisionedRepositoryRow> {
    const target =
      (
        await transaction.$queryRaw<readonly LockedRepositoryClaimTarget[]>(
          Prisma.sql`
          SELECT "id", "teamId", "source"
          FROM "GithubRepository"
          WHERE "githubRepositoryId" = ${input.metadata.githubRepositoryId}
          FOR UPDATE
        `,
        )
      )[0] ?? null;
    if (
      target !== null &&
      target.teamId !== null &&
      target.teamId !== input.teamId
    ) {
      throw new GithubRepositoryClaimConflictError();
    }

    const current = await transaction.githubRepository.findUnique({
      where: { teamId: input.teamId },
      select: { id: true, nameWithOwner: true },
    });
    if (current !== null && current.id !== target?.id) {
      if (input.connectionAudit === undefined) {
        throw RepositoryProvisionFailure.final(
          PROVISION_ERROR_CODES.INVALID_EVENT,
        );
      }
    }

    const deletedCounts =
      current !== null && current.id !== target?.id
        ? await this.repositoryDeletion.deleteRepositoryWithFacts(
            transaction,
            current.id,
          )
        : null;
    const source =
      target?.source === RepositorySource.ORG_PROVISIONED
        ? RepositorySource.ORG_PROVISIONED
        : input.source;
    let repository: ProvisionedRepositoryRow;
    if (target === null) {
      try {
        repository = await transaction.githubRepository.create({
          data: {
            teamId: input.teamId,
            githubRepositoryId: input.metadata.githubRepositoryId,
            nameWithOwner: input.metadata.nameWithOwner,
            visibility: input.metadata.visibility,
            source,
            presence: CollectionRepositoryPresence.PRESENT,
          },
          select: this.repositorySelection,
        });
      } catch (error) {
        if (this.isPrismaUniqueConstraintError(error)) {
          throw new GithubRepositoryClaimConflictError();
        }
        throw error;
      }
    } else {
      const claimed = await transaction.githubRepository.updateMany({
        where: {
          id: target.id,
          OR: [{ teamId: null }, { teamId: input.teamId }],
        },
        data: {
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
        select: this.repositorySelection,
      });
    }

    await transaction.team.update({
      where: { id: input.teamId },
      data: { repositoryConnectionMode: input.connectionMode },
    });
    if (input.connectionAudit !== undefined) {
      const auditActor = await transaction.user.findUniqueOrThrow({
        where: { githubId: input.connectionAudit.actorGithubId },
        select: { id: true },
      });
      const scope = await transaction.team.findUniqueOrThrow({
        where: { id: input.teamId },
        select: { programId: true, program: { select: { name: true } } },
      });
      const actor = await transaction.user.findUniqueOrThrow({
        where: { id: auditActor.id },
        select: { nickname: true },
      });
      await transaction.teamHistory.create({
        data: {
          teamId: input.teamId,
          programId: scope.programId,
          actorId: auditActor.id,
          event: 'REPOSITORY_URL_CHANGED',
          source: 'APPLICATION',
          data: {
            schemaVersion: 1,
            metadata: {
              schemaVersion: 2,
              teamId: input.teamId,
              programId: scope.programId,
              programName: scope.program.name,
              actorGithubLogin: actor.nickname,
              before: {
                repositoryId: current?.id ?? null,
                repositoryUrl: current
                  ? `https://github.com/${current.nameWithOwner}`
                  : null,
              },
              after: {
                repositoryId: repository.id,
                repositoryUrl: `https://github.com/${repository.nameWithOwner}`,
              },
              ...(deletedCounts === null ? {} : { deletedCounts }),
            },
          },
        },
      });
    }
    return repository;
  }

  private matchesProvisionedMetadata(
    repository: OwnedProvisionedRepositoryRow,
    input: RecordProvisionedRepositoryInput,
  ): boolean {
    return (
      repository.teamId === input.teamId &&
      repository.githubRepositoryId === input.metadata.githubRepositoryId &&
      repository.nameWithOwner === input.metadata.nameWithOwner &&
      repository.visibility === input.metadata.visibility
    );
  }

  private readonly repositorySelection = {
    id: true,
    teamId: true,
    githubRepositoryId: true,
    nameWithOwner: true,
    visibility: true,
  } satisfies Prisma.GithubRepositorySelect;

  private readonly teamMemberLoginSelection = {
    user: { select: { nickname: true } },
  } satisfies Prisma.TeamMemberSelect;

  async loadContext(jobId: string, workerId: string, requestId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await this.assertAvailableRequest(
        transaction,
        jobId,
        workerId,
        requestId,
      );
      const job = await transaction.repositoryProvisionJob.findFirst({
        where: this.repositoryProvisionJobRepository.claimedJobWhere(
          jobId,
          workerId,
        ),
        select: {
          currentEventId: true,
          repositoryId: true,
          team: {
            select: {
              id: true,
              status: true,
              programId: true,
              applicant: { select: { githubId: true, nickname: true } },
              program: {
                select: {
                  name: true,
                  repositoryProvisioningEnabled: true,
                },
              },

              name: true,
              members: { select: this.teamMemberLoginSelection },
              repository: {
                select: {
                  ...this.repositorySelection,
                  source: true,
                },
              },
            },
          },
        },
      });
      if (job === null) {
        throw new RepositoryProvisionLeaseLostError();
      }
      const event =
        job.currentEventId === null
          ? null
          : await transaction.outboxEvent.findUnique({
              where: { id: job.currentEventId },
              select: {
                id: true,
                type: true,
                aggregateType: true,
                aggregateId: true,
                payload: true,
              },
            });
      return { job, event };
    });
  }

  async recordRepository(
    input: RecordProvisionedRepositoryInput,
    metadataMatchesRepositoryIdentity: boolean,
  ): Promise<OwnedProvisionedRepositoryRow> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockApplicationForRepositoryClaim(transaction, input.teamId);
        await this.assertAvailableRequest(
          transaction,
          input.jobId,
          input.workerId,
          input.requestId,
        );
        const repository = await this.claimGithubRepositoryForApplication(
          transaction,
          {
            teamId: input.teamId,
            metadata: input.metadata,
            source: input.source,
            connectionMode: input.connectionMode,
            connectionAudit: input.connectionAudit,
          },
        );
        const provisioned = this.assertOwnedRepository(repository);
        if (
          !metadataMatchesRepositoryIdentity ||
          !this.matchesProvisionedMetadata(provisioned, input)
        ) {
          throw RepositoryProvisionFailure.final(
            PROVISION_ERROR_CODES.REPOSITORY_MISMATCH,
          );
        }
        const attached = await transaction.repositoryProvisionJob.updateMany({
          where: this.repositoryProvisionJobRepository.claimedJobWhere(
            input.jobId,
            input.workerId,
          ),
          data: { repositoryId: provisioned.id },
        });
        this.repositoryProvisionJobRepository.assertSingleProvisionUpdate(
          attached.count,
        );
        return provisioned;
      });
    } catch (error) {
      if (
        error instanceof GithubRepositoryClaimConflictError ||
        this.isPrismaUniqueConstraintError(error)
      ) {
        throw RepositoryProvisionFailure.final(
          PROVISION_ERROR_CODES.REPOSITORY_MISMATCH,
        );
      }
      throw error;
    }
  }

  async prepareInvitations(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
    planInvitations: (rows: readonly RepositoryInvitationRow[]) => {
      readonly createLogins: readonly string[];
      readonly revokeIds: readonly string[];
      readonly rejoinIds: readonly string[];
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.assertAvailableRequest(
        transaction,
        jobId,
        workerId,
        requestId,
      );

      const rows = await transaction.repositoryInvitation.findMany({
        where: { repositoryId },
        select: { id: true, githubLogin: true, status: true },
      });
      const plan = planInvitations(rows);

      await transaction.repositoryInvitation.createMany({
        data: plan.createLogins.map((githubLogin) => ({
          repositoryId,
          githubLogin,
        })),
        skipDuplicates: true,
      });

      await transaction.repositoryInvitation.updateMany({
        where: { repositoryId, id: { in: [...plan.revokeIds] } },
        data: {
          status: RepositoryInvitationStatus.REVOKE_REQUIRED,
          attemptCount: 0,
          reconciliationCount: 0,
          lastErrorCode: null,
          lastErrorMessage: null,
          processedAt: null,
        },
      });

      await transaction.repositoryInvitation.updateMany({
        where: { repositoryId, id: { in: [...plan.rejoinIds] } },
        data: {
          status: RepositoryInvitationStatus.PENDING,
          attemptCount: 0,
          reconciliationCount: 0,
          lastErrorCode: null,
          lastErrorMessage: null,
          processedAt: null,
        },
      });
    });
  }

  async findInvitationWork(
    jobId: string,
    workerId: string,
    _requestId: string,
    repositoryId: string,
  ): Promise<readonly RepositoryInvitationRow[]> {
    await this.repositoryProvisionJobRepository.assertProvisionLease(
      this.prisma,
      jobId,
      workerId,
    );
    const rows = await this.prisma.repositoryInvitation.findMany({
      where: {
        repositoryId,
        repository: {
          team: { program: { lifecycle: { not: 'DELETED' } } },
        },
        OR: [
          {
            status: RepositoryInvitationStatus.PENDING,
            reconciliationCount: {
              lt: DEFAULT_PROVISION_MAX_INVITATION_RECONCILIATIONS,
            },
          },
          { status: RepositoryInvitationStatus.FAILED_RETRYABLE },
          { status: RepositoryInvitationStatus.REVOKE_REQUIRED },
          { status: RepositoryInvitationStatus.REVOKE_FAILED_RETRYABLE },

          { status: RepositoryInvitationStatus.REVOKED },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, githubLogin: true, status: true },
    });

    return rows;
  }

  async completeInvitation(
    input: CompleteRepositoryInvitationInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.assertAvailableRequest(
        transaction,
        input.jobId,
        input.workerId,
        input.requestId,
      );

      const updated = await transaction.repositoryInvitation.updateMany({
        where: {
          id: input.invitationId,
          repositoryId: input.repositoryId,
          status: input.expectedStatus,
        },
        data: {
          status: input.status,
          attemptCount: undefined,
          reconciliationCount:
            input.status === RepositoryInvitationStatus.PENDING
              ? { increment: 1 }
              : undefined,
          lastErrorCode: null,
          lastErrorMessage: null,
          processedAt: input.now,
        },
      });
      this.repositoryProvisionJobRepository.assertSingleProvisionUpdate(
        updated.count,
      );
      if (input.status !== RepositoryInvitationStatus.PENDING) {
        return;
      }

      await transaction.repositoryInvitation.updateMany({
        where: {
          id: input.invitationId,
          status: RepositoryInvitationStatus.PENDING,
          reconciliationCount: {
            gte: DEFAULT_PROVISION_MAX_INVITATION_RECONCILIATIONS,
          },
        },
        data: {
          status: RepositoryInvitationStatus.FAILED_FINAL,
          lastErrorCode:
            PROVISION_ERROR_CODES.INVITATION_RECONCILIATION_EXHAUSTED,
          processedAt: input.now,
        },
      });
    });
  }

  async failInvitation(input: FailRepositoryInvitationInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.assertAvailableRequest(
        transaction,
        input.jobId,
        input.workerId,
        input.requestId,
      );
      const updated = await transaction.repositoryInvitation.updateMany({
        where: {
          id: input.invitationId,
          repositoryId: input.repositoryId,
          status: input.expectedStatus,
        },
        data: {
          status: failedInvitationStatus(input),
          attemptCount: { increment: 1 },
          lastErrorCode: input.errorCode,
          lastErrorMessage: null,
          processedAt: input.now,
        },
      });
      this.repositoryProvisionJobRepository.assertSingleProvisionUpdate(
        updated.count,
      );
    });
  }

  async recordSupersededRequest(
    teamId: string,
    requestId: string,
    now: Date,
    parsePayload: RepositoryProvisionHistoryPayloadParser,
  ): Promise<void> {
    await this.prisma.$transaction((transaction) =>
      this.repositoryProvisionGenerationRepository.writeRepositoryIssuanceHistory(
        transaction,
        {
          requestId,
          teamId,

          repositoryId: null,
          source: null,
          outcome: RepositoryIssuanceOutcome.SUPERSEDED,
          closedAt: now,
        },
        parsePayload,
      ),
    );
  }

  async completeJob(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
    now: Date,
    nextReconciliationAt: Date | undefined,
    isMembershipCurrent: MembershipCurrencyCheck | undefined,
    parsePayload: RepositoryProvisionHistoryPayloadParser,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const { teamId } = await this.assertAvailableRequest(
        transaction,
        jobId,
        workerId,
        requestId,
      );
      const stale =
        isMembershipCurrent === undefined
          ? false
          : !isMembershipCurrent(
              await this.currentMemberLogins(transaction, teamId),
            );
      const updated = await transaction.repositoryProvisionJob.updateMany({
        where: this.repositoryProvisionJobRepository.claimedJobWhere(
          jobId,
          workerId,
        ),
        data: stale
          ? rearmedProvisionJobData(now, repositoryId)
          : {
              repositoryId,
              status: RepositoryProvisionJobStatus.SUCCEEDED,
              nextAttemptAt: nextReconciliationAt ?? now,
              lockedAt: null,
              lockedBy: null,
              lastErrorCode: null,
              lastErrorMessage: null,
              finishedAt: now,
            },
      });
      this.repositoryProvisionJobRepository.assertSingleProvisionUpdate(
        updated.count,
      );
      if (!stale) {
        const repository = await transaction.githubRepository.findUniqueOrThrow(
          {
            where: { id: repositoryId },
            select: { source: true },
          },
        );
        await this.repositoryProvisionGenerationRepository.writeRepositoryIssuanceHistory(
          transaction,
          {
            requestId,
            teamId,
            repositoryId,
            source: repository.source,
            outcome: RepositoryIssuanceOutcome.SUCCEEDED,
            closedAt: now,
          },
          parsePayload,
        );
      }
    });
  }

  private async assertAvailableRequest(
    transaction: Prisma.TransactionClient,
    jobId: string,
    workerId: string,
    requestId: string,
  ) {
    const job =
      await this.repositoryProvisionJobRepository.assertCurrentRequest(
        transaction,
        jobId,
        workerId,
        requestId,
      );
    const available = await transaction.team.count({
      where: {
        id: job.teamId,
        program: { lifecycle: { not: 'DELETED' } },
      },
    });
    if (available === 0) {
      throw RepositoryProvisionFailure.final(
        PROVISION_ERROR_CODES.FEATURE_DISABLED,
      );
    }
    return job;
  }

  private async currentMemberLogins(
    transaction: Prisma.TransactionClient,
    teamId: string,
  ): Promise<readonly string[]> {
    const application = await transaction.team.findUnique({
      where: { id: teamId },
      select: { id: true },
    });
    if (application === null) {
      return [];
    }
    const members = await transaction.teamMember.findMany({
      where: { teamId: application.id },
      select: this.teamMemberLoginSelection,
    });
    return members.map((member) => member.user.nickname);
  }

  async failJob(
    input: FailRepositoryProvisionJobInput,
    isMembershipCurrent: MembershipCurrencyCheck | undefined,
    parsePayload: RepositoryProvisionHistoryPayloadParser,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const { teamId, repositoryId } =
        await this.repositoryProvisionJobRepository.assertCurrentRequest(
          transaction,
          input.jobId,
          input.workerId,
          input.requestId,
        );
      const stale =
        isMembershipCurrent === undefined ||
        input.errorCode === PROVISION_ERROR_CODES.FEATURE_DISABLED
          ? false
          : !isMembershipCurrent(
              await this.currentMemberLogins(transaction, teamId),
            );
      const updated = await transaction.repositoryProvisionJob.updateMany({
        where: this.repositoryProvisionJobRepository.claimedJobWhere(
          input.jobId,
          input.workerId,
        ),
        data: stale
          ? rearmedProvisionJobData(input.now)
          : {
              status: input.final
                ? RepositoryProvisionJobStatus.FAILED_FINAL
                : RepositoryProvisionJobStatus.FAILED_RETRYABLE,
              nextAttemptAt: input.nextAttemptAt,
              lockedAt: null,
              lockedBy: null,
              lastErrorCode: input.errorCode,
              lastErrorMessage: null,
              finishedAt: input.final ? input.now : null,
            },
      });
      this.repositoryProvisionJobRepository.assertSingleProvisionUpdate(
        updated.count,
      );
      if (!stale && input.final) {
        const repository =
          repositoryId === null
            ? null
            : await transaction.githubRepository.findUnique({
                where: { id: repositoryId },
                select: { source: true },
              });
        await this.repositoryProvisionGenerationRepository.writeRepositoryIssuanceHistory(
          transaction,
          {
            requestId: input.requestId,
            teamId,
            repositoryId,
            source: repository?.source ?? null,
            outcome: RepositoryIssuanceOutcome.FAILED_FINAL,
            lastErrorCode: input.errorCode,
            closedAt: input.now,
          },
          parsePayload,
        );
      }
    });
  }
}
