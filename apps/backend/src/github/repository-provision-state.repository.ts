import { Injectable } from '@nestjs/common';
import {
  Prisma,
  RepositoryConnectionMode,
  RepositoryIssuanceOutcome,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositorySource,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import {
  parseRepositoryProvisionEvent,
  REPOSITORY_PROVISION_EVENT_TYPE,
  canonicalGithubLogin,
  canonicalGithubLogins,
} from './repository-provision-event.config';
import {
  RepositoryProvisionStateHelpersRepository,
  type CompleteRepositoryInvitationInput,
  type FailRepositoryInvitationInput,
  type FailRepositoryProvisionJobInput,
  type ProvisionedRepository,
  type RecordProvisionedRepositoryInput,
  type RepositoryInvitationWork,
  type RepositoryProvisionContext,
  type RepositoryProvisionStateStore,
} from './repository-provision-state-helpers.repository';
import {
  PROVISION_MEMBERSHIP_UNAVAILABLE_ERROR_CODE,
  DEFAULT_PROVISION_MAX_INVITATION_RECONCILIATIONS,
  PROVISION_ERROR_CODES,
  finalProvisionFailure,
} from './repository-provision-state.config';
import {
  GithubRepositoryClaimConflictError,
  RepositoryProvisionLeaseLostError,
} from './repository-provision-state.error';

import { InvalidRepositoryProvisionEventError } from './repositories.error';

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

@Injectable()
export class RepositoryProvisionStateRepository implements RepositoryProvisionStateStore {
  constructor(private readonly prisma: PrismaService) {}

  async loadContext(
    jobId: string,
    workerId: string,
    requestId: string,
  ): Promise<RepositoryProvisionContext> {
    return this.prisma.$transaction(async (transaction) => {
      await RepositoryProvisionStateHelpersRepository.assertCurrentRequest(
        transaction,
        jobId,
        workerId,
        requestId,
      );
      const job = await transaction.repositoryProvisionJob.findFirst({
        where: RepositoryProvisionStateHelpersRepository.claimedJobWhere(
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
                      RepositoryProvisionStateHelpersRepository.teamMemberLoginSelection,
                  },
                },
              },
              repository: {
                select: {
                  ...RepositoryProvisionStateHelpersRepository.repositorySelection,
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
      if (job.currentEventId === null) {
        throw finalProvisionFailure(PROVISION_ERROR_CODES.INVALID_EVENT);
      }
      const application = job.application;
      const event = await transaction.outboxEvent.findUnique({
        where: { id: job.currentEventId },
        select: {
          id: true,
          type: true,
          aggregateType: true,
          aggregateId: true,
          payload: true,
        },
      });
      if (event === null) {
        throw finalProvisionFailure(PROVISION_ERROR_CODES.INVALID_EVENT);
      }
      let requested: ReturnType<typeof parseRepositoryProvisionEvent>;
      try {
        if (
          event.type !== REPOSITORY_PROVISION_EVENT_TYPE ||
          event.aggregateType !== 'Application' ||
          event.aggregateId !== application.id
        ) {
          throw new InvalidRepositoryProvisionEventError();
        }
        requested = parseRepositoryProvisionEvent(event.payload);
        if (
          requested.applicationId !== application.id ||
          requested.programId !== application.programId ||
          (requested.teamId !== null && requested.teamId !== application.teamId)
        ) {
          throw new InvalidRepositoryProvisionEventError();
        }
      } catch (error) {
        if (error instanceof InvalidRepositoryProvisionEventError) {
          throw finalProvisionFailure(PROVISION_ERROR_CODES.INVALID_EVENT);
        }
        throw error;
      }
      const team = application.team;
      const requiresManagedMembership =
        application.repository === null
          ? requested.repositoryConnectionMode === RepositoryConnectionMode.NEW
          : application.repository.source === RepositorySource.ORG_PROVISIONED;
      if (team === null && requiresManagedMembership) {
        throw finalProvisionFailure(
          PROVISION_MEMBERSHIP_UNAVAILABLE_ERROR_CODE,
        );
      }

      const currentMemberGithubLogins =
        team === null
          ? []
          : RepositoryProvisionStateHelpersRepository.loginsFromTeamMembers(
              team.members,
            );
      return {
        requestId: event.id,
        requestedConnectionMode: requested.repositoryConnectionMode,
        requestedRepositoryUrl: requested.repositoryUrl,
        requestedByGithubId:
          requested.requestedByGithubId == null
            ? null
            : BigInt(requested.requestedByGithubId),
        currentConnectionMode: application.repositoryConnectionMode,
        currentRepositoryUrl: application.repositoryUrl,
        applicationId: application.id,
        applicantGithubId: application.applicant.githubId,
        applicationStatus: application.status,
        programId: application.programId,
        programName: application.program.name,
        repositoryProvisioningEnabled:
          application.program.repositoryProvisioningEnabled,
        teamId: application.teamId,
        subjectName: team?.name ?? application.applicant.nickname,
        currentMemberGithubLogins,
        membershipFingerprint:
          RepositoryProvisionStateHelpersRepository.membershipFingerprint(
            currentMemberGithubLogins,
          ),
        currentRepositorySource: application.repository?.source ?? null,
        repository:
          application.repository === null ||
          job.repositoryId !== application.repository.id
            ? null
            : RepositoryProvisionStateHelpersRepository.toProvisionedRepository(
                application.repository,
              ),
      };
    });
  }

  async recordRepository(
    input: RecordProvisionedRepositoryInput,
  ): Promise<ProvisionedRepository> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await RepositoryProvisionStateHelpersRepository.lockApplicationForRepositoryClaim(
          transaction,
          input.applicationId,
        );
        await RepositoryProvisionStateHelpersRepository.assertCurrentRequest(
          transaction,
          input.jobId,
          input.workerId,
          input.requestId,
        );
        const repository =
          await RepositoryProvisionStateHelpersRepository.claimGithubRepositoryForApplication(
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
          RepositoryProvisionStateHelpersRepository.toProvisionedRepository(
            repository,
          );
        if (
          !RepositoryProvisionStateHelpersRepository.matchesProvisionedMetadata(
            provisioned,
            input,
          )
        ) {
          throw finalProvisionFailure(
            PROVISION_ERROR_CODES.REPOSITORY_MISMATCH,
          );
        }
        const attached = await transaction.repositoryProvisionJob.updateMany({
          where: RepositoryProvisionStateHelpersRepository.claimedJobWhere(
            input.jobId,
            input.workerId,
          ),
          data: { repositoryId: provisioned.id },
        });
        RepositoryProvisionStateHelpersRepository.assertSingleProvisionUpdate(
          attached.count,
        );
        return provisioned;
      });
    } catch (error) {
      if (
        error instanceof GithubRepositoryClaimConflictError ||
        RepositoryProvisionStateHelpersRepository.isPrismaUniqueConstraintError(
          error,
        )
      ) {
        throw finalProvisionFailure(PROVISION_ERROR_CODES.REPOSITORY_MISMATCH);
      }
      throw error;
    }
  }

  async prepareInvitations(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
    githubLogins: readonly string[],
  ): Promise<void> {
    const desired = canonicalGithubLogins(githubLogins);
    await this.prisma.$transaction(async (transaction) => {
      await RepositoryProvisionStateHelpersRepository.assertCurrentRequest(
        transaction,
        jobId,
        workerId,
        requestId,
      );

      const rows = await transaction.repositoryInvitation.findMany({
        where: { repositoryId },
        select: { id: true, githubLogin: true, status: true },
      });
      const desiredSet = new Set(desired);
      const known = new Set(
        rows.map((row) => canonicalGithubLogin(row.githubLogin)),
      );
      const isRevocation = (status: RepositoryInvitationStatus): boolean =>
        RepositoryProvisionStateHelpersRepository.invitationIntent(status) ===
        'REVOKE';

      await transaction.repositoryInvitation.createMany({
        data: desired
          .filter((githubLogin) => !known.has(githubLogin))
          .map((githubLogin) => ({ repositoryId, githubLogin })),
        skipDuplicates: true,
      });

      const revokeIds = rows
        .filter(
          (row) =>
            !desiredSet.has(canonicalGithubLogin(row.githubLogin)) &&
            !isRevocation(row.status),
        )
        .map((row) => row.id);
      await transaction.repositoryInvitation.updateMany({
        where: { repositoryId, id: { in: revokeIds } },
        data: {
          status: RepositoryInvitationStatus.REVOKE_REQUIRED,
          attemptCount: 0,
          reconciliationCount: 0,
          lastErrorCode: null,
          lastErrorMessage: null,
          processedAt: null,
        },
      });

      const rejoinIds = rows
        .filter(
          (row) =>
            desiredSet.has(canonicalGithubLogin(row.githubLogin)) &&
            isRevocation(row.status),
        )
        .map((row) => row.id);
      await transaction.repositoryInvitation.updateMany({
        where: { repositoryId, id: { in: rejoinIds } },
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
  ): Promise<readonly RepositoryInvitationWork[]> {
    await RepositoryProvisionStateHelpersRepository.assertProvisionLease(
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

    const work = rows.map((row) => ({
      id: row.id,
      githubLogin: row.githubLogin,
      status: row.status,
      intent: RepositoryProvisionStateHelpersRepository.invitationIntent(
        row.status,
      ),
    }));
    return [
      ...work.filter((item) => item.intent === 'REVOKE'),
      ...work.filter((item) => item.intent === 'GRANT'),
    ];
  }

  async completeInvitation(
    input: CompleteRepositoryInvitationInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await RepositoryProvisionStateHelpersRepository.assertCurrentRequest(
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
      RepositoryProvisionStateHelpersRepository.assertSingleProvisionUpdate(
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
      await RepositoryProvisionStateHelpersRepository.assertCurrentRequest(
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
      RepositoryProvisionStateHelpersRepository.assertSingleProvisionUpdate(
        updated.count,
      );
    });
  }

  async recordSupersededRequest(
    applicationId: string,
    requestId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction((transaction) =>
      RepositoryProvisionGenerationRepository.writeRepositoryIssuanceHistory(
        transaction,
        {
          requestId,
          applicationId,

          repositoryId: null,
          source: null,
          outcome: RepositoryIssuanceOutcome.SUPERSEDED,
          closedAt: now,
        },
        parseRepositoryProvisionEvent,
      ),
    );
  }

  async completeJob(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
    now: Date,
    nextReconciliationAt?: Date,
    expectedMembershipFingerprint?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const { applicationId } =
        await RepositoryProvisionStateHelpersRepository.lockClaimedProvisionJob(
          transaction,
          jobId,
          workerId,
          requestId,
        );
      const stale =
        expectedMembershipFingerprint === undefined
          ? false
          : (await this.currentMembershipFingerprint(
              transaction,
              applicationId,
            )) !== expectedMembershipFingerprint;
      const updated = await transaction.repositoryProvisionJob.updateMany({
        where: RepositoryProvisionStateHelpersRepository.claimedJobWhere(
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
      RepositoryProvisionStateHelpersRepository.assertSingleProvisionUpdate(
        updated.count,
      );
      if (!stale) {
        const repository = await transaction.githubRepository.findUniqueOrThrow(
          {
            where: { id: repositoryId },
            select: { source: true },
          },
        );
        await RepositoryProvisionGenerationRepository.writeRepositoryIssuanceHistory(
          transaction,
          {
            requestId,
            applicationId,
            repositoryId,
            source: repository.source,
            outcome: RepositoryIssuanceOutcome.SUCCEEDED,
            closedAt: now,
          },
          parseRepositoryProvisionEvent,
        );
      }
    });
  }

  private async currentMembershipFingerprint(
    transaction: Prisma.TransactionClient,
    applicationId: string,
  ): Promise<string> {
    const application = await transaction.application.findUnique({
      where: { id: applicationId },
      select: { teamId: true },
    });
    if (application?.teamId == null) {
      return RepositoryProvisionStateHelpersRepository.membershipFingerprint(
        [],
      );
    }
    const members = await transaction.teamMember.findMany({
      where: { teamId: application.teamId },
      select:
        RepositoryProvisionStateHelpersRepository.teamMemberLoginSelection,
    });
    return RepositoryProvisionStateHelpersRepository.membershipFingerprint(
      RepositoryProvisionStateHelpersRepository.loginsFromTeamMembers(members),
    );
  }

  async failJob(input: FailRepositoryProvisionJobInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const { applicationId, repositoryId } =
        await RepositoryProvisionStateHelpersRepository.lockClaimedProvisionJob(
          transaction,
          input.jobId,
          input.workerId,
          input.requestId,
        );
      const stale =
        input.expectedMembershipFingerprint === undefined
          ? false
          : (await this.currentMembershipFingerprint(
              transaction,
              applicationId,
            )) !== input.expectedMembershipFingerprint;
      const updated = await transaction.repositoryProvisionJob.updateMany({
        where: RepositoryProvisionStateHelpersRepository.claimedJobWhere(
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
      RepositoryProvisionStateHelpersRepository.assertSingleProvisionUpdate(
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
        await RepositoryProvisionGenerationRepository.writeRepositoryIssuanceHistory(
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
          parseRepositoryProvisionEvent,
        );
      }
    });
  }
}
