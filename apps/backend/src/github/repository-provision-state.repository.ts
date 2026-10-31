import { Injectable } from '@nestjs/common';
import {
  Prisma,
  RepositoryIssuanceOutcome,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  RepositoryProvisionGenerationRepository,
  type RepositoryProvisionHistoryPayloadParser,
} from '../platform/repository-provision-generation.repository';
import {
  RepositoryProvisionStateHelpersRepository,
  type CompleteRepositoryInvitationInput,
  type FailRepositoryInvitationInput,
  type FailRepositoryProvisionJobInput,
  type RecordProvisionedRepositoryInput,
} from './repository-provision-state-helpers.repository';
import {
  DEFAULT_PROVISION_MAX_INVITATION_RECONCILIATIONS,
  PROVISION_ERROR_CODES,
} from './repository-provision-state.config';
import {
  GithubRepositoryClaimConflictError,
  RepositoryProvisionLeaseLostError,
  RepositoryProvisionFailure,
} from './repository-provision-state.error';

import type { OwnedProvisionedRepositoryRow } from './repository-provision-state-helpers.repository';

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
    private readonly repositoryProvisionStateHelpersRepository: RepositoryProvisionStateHelpersRepository,
  ) {}

  async loadContext(jobId: string, workerId: string, requestId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await this.repositoryProvisionStateHelpersRepository.assertCurrentRequest(
        transaction,
        jobId,
        workerId,
        requestId,
      );
      const job = await transaction.repositoryProvisionJob.findFirst({
        where: this.repositoryProvisionStateHelpersRepository.claimedJobWhere(
          jobId,
          workerId,
        ),
        select: {
          currentEventId: true,
          repositoryId: true,
          application: {
            select: {
              id: true,
              status: true,
              programId: true,
              teamId: true,
              repositoryConnectionMode: true,
              repositoryUrl: true,
              applicant: { select: { githubId: true, nickname: true } },
              program: {
                select: {
                  name: true,
                  repositoryProvisioningEnabled: true,
                },
              },

              team: {
                select: {
                  name: true,
                  members: {
                    select:
                      this.repositoryProvisionStateHelpersRepository
                        .teamMemberLoginSelection,
                  },
                },
              },
              repository: {
                select: {
                  ...this.repositoryProvisionStateHelpersRepository
                    .repositorySelection,
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
        await this.repositoryProvisionStateHelpersRepository.lockApplicationForRepositoryClaim(
          transaction,
          input.applicationId,
        );
        await this.repositoryProvisionStateHelpersRepository.assertCurrentRequest(
          transaction,
          input.jobId,
          input.workerId,
          input.requestId,
        );
        const repository =
          await this.repositoryProvisionStateHelpersRepository.claimGithubRepositoryForApplication(
            transaction,
            {
              applicationId: input.applicationId,
              programId: input.programId,
              teamId: input.teamId,
              metadata: input.metadata,
              source: input.source,
              currentConnectionMode: input.currentConnectionMode,
              currentRepositoryUrl: input.currentRepositoryUrl,
              connectionMode: input.connectionMode,
              repositoryUrl: input.repositoryUrl,
              connectionAudit: input.connectionAudit,
            },
          );
        const provisioned =
          this.repositoryProvisionStateHelpersRepository.assertOwnedRepository(
            repository,
          );
        if (
          !metadataMatchesRepositoryIdentity ||
          !this.repositoryProvisionStateHelpersRepository.matchesProvisionedMetadata(
            provisioned,
            input,
          )
        ) {
          throw RepositoryProvisionFailure.final(
            PROVISION_ERROR_CODES.REPOSITORY_MISMATCH,
          );
        }
        const attached = await transaction.repositoryProvisionJob.updateMany({
          where: this.repositoryProvisionStateHelpersRepository.claimedJobWhere(
            input.jobId,
            input.workerId,
          ),
          data: { repositoryId: provisioned.id },
        });
        this.repositoryProvisionStateHelpersRepository.assertSingleProvisionUpdate(
          attached.count,
        );
        return provisioned;
      });
    } catch (error) {
      if (
        error instanceof GithubRepositoryClaimConflictError ||
        this.repositoryProvisionStateHelpersRepository.isPrismaUniqueConstraintError(
          error,
        )
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
      await this.repositoryProvisionStateHelpersRepository.assertCurrentRequest(
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
    await this.repositoryProvisionStateHelpersRepository.assertProvisionLease(
      this.prisma,
      jobId,
      workerId,
    );
    const rows = await this.prisma.repositoryInvitation.findMany({
      where: {
        repositoryId,
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
      await this.repositoryProvisionStateHelpersRepository.assertCurrentRequest(
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
      this.repositoryProvisionStateHelpersRepository.assertSingleProvisionUpdate(
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
      await this.repositoryProvisionStateHelpersRepository.assertCurrentRequest(
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
      this.repositoryProvisionStateHelpersRepository.assertSingleProvisionUpdate(
        updated.count,
      );
    });
  }

  async recordSupersededRequest(
    applicationId: string,
    requestId: string,
    now: Date,
    parsePayload: RepositoryProvisionHistoryPayloadParser,
  ): Promise<void> {
    await this.prisma.$transaction((transaction) =>
      this.repositoryProvisionGenerationRepository.writeRepositoryIssuanceHistory(
        transaction,
        {
          requestId,
          applicationId,

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
      const { applicationId } =
        await this.repositoryProvisionStateHelpersRepository.lockClaimedProvisionJob(
          transaction,
          jobId,
          workerId,
          requestId,
        );
      const stale =
        isMembershipCurrent === undefined
          ? false
          : !isMembershipCurrent(
              await this.currentMemberLogins(transaction, applicationId),
            );
      const updated = await transaction.repositoryProvisionJob.updateMany({
        where: this.repositoryProvisionStateHelpersRepository.claimedJobWhere(
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
      this.repositoryProvisionStateHelpersRepository.assertSingleProvisionUpdate(
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
            applicationId,
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

  private async currentMemberLogins(
    transaction: Prisma.TransactionClient,
    applicationId: string,
  ): Promise<readonly string[]> {
    const application = await transaction.application.findUnique({
      where: { id: applicationId },
      select: { teamId: true },
    });
    if (application?.teamId == null) {
      return [];
    }
    const members = await transaction.teamMember.findMany({
      where: { teamId: application.teamId },
      select:
        this.repositoryProvisionStateHelpersRepository.teamMemberLoginSelection,
    });
    return members.map((member) => member.user.nickname);
  }

  async failJob(
    input: FailRepositoryProvisionJobInput,
    isMembershipCurrent: MembershipCurrencyCheck | undefined,
    parsePayload: RepositoryProvisionHistoryPayloadParser,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const { applicationId, repositoryId } =
        await this.repositoryProvisionStateHelpersRepository.lockClaimedProvisionJob(
          transaction,
          input.jobId,
          input.workerId,
          input.requestId,
        );
      const stale =
        isMembershipCurrent === undefined
          ? false
          : !isMembershipCurrent(
              await this.currentMemberLogins(transaction, applicationId),
            );
      const updated = await transaction.repositoryProvisionJob.updateMany({
        where: this.repositoryProvisionStateHelpersRepository.claimedJobWhere(
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
      this.repositoryProvisionStateHelpersRepository.assertSingleProvisionUpdate(
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
            applicationId,
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
