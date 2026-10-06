import { Logger } from '@nestjs/common';
import {
  ApplicationStatus,
  RepositoryInvitationStatus,
  RepositorySource,
} from '@prisma/client';
import {
  COLLABORATOR_OUTCOMES,
  type GithubAppClient,
} from './github-app.client';
import type { RepositoryOwnEnrollmentService } from './service/repository-own-enrollment.service';
import type { RepositoryProvisionJobRepository } from './repository/repository-provision-job.repository';
import type {
  ProvisionedRepository,
  RepositoryInvitationWork,
  RepositoryProvisionContext,
  RepositoryProvisionStateStore,
} from './repository-provision.contract';
import {
  DEFAULT_PROVISION_OPTIONS,
  DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
  finalProvisionFailure,
  normalizeProvisionFailure,
  PROVISION_ERROR_CODES,
  provisionRetryAt,
  type RepositoryProvisionWorkerOptions,
} from './repository-provision.failure';
import {
  findOrCreateGithubRepository,
  resolveOwnGithubRepository,
  type OwnGithubRepositoryResolution,
} from './repository-provision.github';
import {
  buildRepositoryNames,
  buildRepositoryOwnershipMarker,
} from './repository-name';
import {
  RepositoryProvisionLeaseLostError,
  RepositoryProvisionSupersededError,
} from './repository-provision-state.helpers';

export type RepositoryProvisionResult =
  | { readonly kind: 'EMPTY' }
  | {
      readonly kind: 'SUCCEEDED';
      readonly jobId: string;
      readonly repositoryId: string;
    }
  | {
      readonly kind: 'FAILED_RETRYABLE' | 'FAILED_FINAL';
      readonly jobId: string;
      readonly errorCode: string;
    }
  | {
      readonly kind: 'SUPERSEDED';
      readonly jobId: string;
      readonly requestId: string;
    };

interface PreparedRepository {
  readonly repository: ProvisionedRepository;
  readonly ownResolution: OwnGithubRepositoryResolution | null;
}

export class RepositoryProvisionWorker {
  private readonly logger = new Logger(RepositoryProvisionWorker.name);

  constructor(
    private readonly jobs: Pick<
      RepositoryProvisionJobRepository,
      'claimNext' | 'claimNextReconciliation' | 'renewLease'
    >,
    private readonly state: RepositoryProvisionStateStore,
    private readonly github: Pick<
      GithubAppClient,
      | 'findRepository'
      | 'createRepository'
      | 'ensureCollaborator'
      | 'revokeCollaborator'
      | 'findPublicRepository'
      | 'organization'
    >,

    private readonly collectionEnrollment: Pick<
      RepositoryOwnEnrollmentService,
      'enrollExternalRepository'
    >,
    private readonly options: RepositoryProvisionWorkerOptions = DEFAULT_PROVISION_OPTIONS,
  ) {}

  async runNext(
    workerId: string,
    fixedNow?: Date,
  ): Promise<RepositoryProvisionResult> {
    const now = (): Date => fixedNow ?? new Date();
    const claimInput = {
      workerId,
      now: now(),
      leaseMs: this.options.leaseMs,
    };
    const job =
      (await this.jobs.claimNext(claimInput)) ??
      (await this.jobs.claimNextReconciliation(claimInput));
    if (job == null) {
      return { kind: 'EMPTY' };
    }

    let membershipFingerprint: string | undefined;
    try {
      const claimed = await this.state.loadContext(
        job.id,
        workerId,
        job.requestId,
      );
      const { originalIntent, repositoryUrl } = this.validateContext(claimed);
      let context = claimed;
      let prepared: PreparedRepository;
      if (claimed.repository === null) {
        if (originalIntent === 'NEW') {
          membershipFingerprint = claimed.membershipFingerprint;
        }
        prepared = await this.createAndRecordRepository(
          claimed,
          originalIntent,
          repositoryUrl,
          job.id,
          workerId,
          job.requestId,
          now,
        );
        context = await this.reloadRecordedContext(
          job.id,
          workerId,
          claimed,
          prepared.repository,
        );
      } else {
        prepared = { repository: claimed.repository, ownResolution: null };
      }
      const repository = context.repository;
      if (repository === null) {
        throw finalProvisionFailure(PROVISION_ERROR_CODES.REPOSITORY_MISMATCH);
      }
      const accessPath = this.resolveAccessPath(
        context.currentRepositorySource,
      );
      membershipFingerprint =
        accessPath === 'MANAGED' ? context.membershipFingerprint : undefined;
      if (accessPath === 'EXTERNAL') {
        const completedAt = now();
        if (prepared.ownResolution !== null) {
          const resolution = prepared.ownResolution;
          if (
            resolution.repository.githubRepositoryId !==
            repository.githubRepositoryId
          ) {
            throw finalProvisionFailure(
              PROVISION_ERROR_CODES.REPOSITORY_MISMATCH,
            );
          }

          if (resolution.kind !== 'EXTERNAL') {
            throw finalProvisionFailure(
              PROVISION_ERROR_CODES.REPOSITORY_MISMATCH,
            );
          }
          const externalRepository = resolution.repository;
          await this.collectionEnrollment.enrollExternalRepository({
            applicantGithubId: context.applicantGithubId,
            githubRepositoryId: repository.githubRepositoryId,
            nameWithOwner: externalRepository.nameWithOwner,
            defaultBranch: externalRepository.defaultBranch,
            archived: externalRepository.archived,
            observedAt: completedAt,
          });
        }
        await this.state.completeJob(
          job.id,
          workerId,
          job.requestId,
          repository.id,
          completedAt,
        );
        this.logResult(context, job.id, job.attemptCount, 'SUCCEEDED');
        return {
          kind: 'SUCCEEDED',
          jobId: job.id,
          repositoryId: repository.id,
        };
      }

      await this.state.prepareInvitations(
        job.id,
        workerId,
        job.requestId,
        repository.id,
        context.currentMemberGithubLogins,
      );
      const invitations = await this.state.findInvitationWork(
        job.id,
        workerId,
        job.requestId,
        repository.id,
      );
      await this.processInvitations(
        invitations,
        repository,
        job.id,
        workerId,
        job.requestId,
        job.attemptCount,
        now,
      );
      const completedAt = now();

      await this.state.completeJob(
        job.id,
        workerId,
        job.requestId,
        repository.id,
        completedAt,
        new Date(
          completedAt.getTime() +
            DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
        ),
        context.membershipFingerprint,
      );
      this.logResult(context, job.id, job.attemptCount, 'SUCCEEDED');
      return { kind: 'SUCCEEDED', jobId: job.id, repositoryId: repository.id };
    } catch (error) {
      if (error instanceof RepositoryProvisionSupersededError) {
        const supersededAt = now();
        await this.state.recordSupersededRequest(
          job.applicationId,
          error.staleRequestId,
          supersededAt,
        );
        this.logger.log({
          event: 'repositories.provision.superseded',
          jobId: job.id,
          applicationId: job.applicationId,
          requestId: error.staleRequestId,
        });
        return {
          kind: 'SUPERSEDED',
          jobId: job.id,
          requestId: error.staleRequestId,
        };
      }
      if (error instanceof RepositoryProvisionLeaseLostError) {
        throw error;
      }
      const failure = normalizeProvisionFailure(error);
      const final =
        !failure.retryable || job.attemptCount >= this.options.maxAttempts;
      const failedAt = now();
      await this.state.failJob({
        jobId: job.id,
        workerId,
        requestId: job.requestId,
        final,
        errorCode: failure.code,
        nextAttemptAt: final
          ? failedAt
          : provisionRetryAt(
              failure,
              job.attemptCount,
              failedAt,
              this.options.retryBaseMs,
            ),
        now: failedAt,

        expectedMembershipFingerprint: membershipFingerprint,
      });
      this.logger.warn({
        event: 'repositories.provision.failed',
        jobId: job.id,
        applicationId: job.applicationId,
        attempt: job.attemptCount,
        errorCode: failure.code,
      });
      return {
        kind: final ? 'FAILED_FINAL' : 'FAILED_RETRYABLE',
        jobId: job.id,
        errorCode: failure.code,
      };
    }
  }

  private validateContext(context: RepositoryProvisionContext): {
    readonly originalIntent: 'NEW' | 'OWN';
    readonly repositoryUrl: string | null;
  } {
    if (context.applicationStatus !== ApplicationStatus.APPROVED) {
      throw finalProvisionFailure(
        PROVISION_ERROR_CODES.APPLICATION_NOT_APPROVED,
      );
    }
    if (!context.repositoryProvisioningEnabled) {
      throw finalProvisionFailure(PROVISION_ERROR_CODES.FEATURE_DISABLED);
    }
    return {
      originalIntent: context.requestedConnectionMode,
      repositoryUrl: context.requestedRepositoryUrl,
    };
  }

  private resolveAccessPath(
    source: RepositorySource | null,
  ): 'MANAGED' | 'EXTERNAL' {
    if (source === RepositorySource.ORG_PROVISIONED) {
      return 'MANAGED';
    }
    if (source === RepositorySource.EXTERNAL_PUBLIC) {
      return 'EXTERNAL';
    }
    throw finalProvisionFailure(PROVISION_ERROR_CODES.REPOSITORY_MISMATCH);
  }

  private async reloadRecordedContext(
    jobId: string,
    workerId: string,
    claimed: RepositoryProvisionContext,
    recorded: ProvisionedRepository,
  ): Promise<RepositoryProvisionContext> {
    const reloaded = await this.state.loadContext(
      jobId,
      workerId,
      claimed.requestId,
    );
    this.validateContext(reloaded);
    if (
      reloaded.applicationId !== claimed.applicationId ||
      reloaded.programId !== claimed.programId ||
      reloaded.requestId !== claimed.requestId
    ) {
      throw finalProvisionFailure(PROVISION_ERROR_CODES.INVALID_EVENT);
    }
    const current = reloaded.repository;
    if (
      current === null ||
      reloaded.currentRepositorySource === null ||
      current.id !== recorded.id ||
      current.githubRepositoryId !== recorded.githubRepositoryId ||
      current.applicationId !== claimed.applicationId
    ) {
      throw finalProvisionFailure(PROVISION_ERROR_CODES.REPOSITORY_MISMATCH);
    }
    return reloaded;
  }

  private async createAndRecordRepository(
    context: RepositoryProvisionContext,
    connectionMode: 'NEW' | 'OWN',
    repositoryUrl: string | null,
    jobId: string,
    workerId: string,
    requestId: string,
    now: () => Date,
  ): Promise<PreparedRepository> {
    await this.jobs.renewLease(jobId, workerId, requestId, now());
    const ownResolution =
      connectionMode === 'OWN'
        ? await resolveOwnGithubRepository(
            this.github,

            repositoryUrl ?? '',
          )
        : null;
    const metadata =
      ownResolution?.repository ??
      (await findOrCreateGithubRepository(
        this.github,
        buildRepositoryNames({
          programName: context.programName,
          programId: context.programId,
          subjectName: context.subjectName,
          applicationId: context.applicationId,
        }),
        buildRepositoryOwnershipMarker(context.applicationId),
      ));

    const source =
      ownResolution?.kind === 'EXTERNAL'
        ? RepositorySource.EXTERNAL_PUBLIC
        : RepositorySource.ORG_PROVISIONED;
    const repository = await this.state.recordRepository({
      jobId,
      workerId,
      requestId,
      applicationId: context.applicationId,
      programId: context.programId,
      teamId: context.teamId,
      connectionMode,
      repositoryUrl,
      currentConnectionMode: context.currentConnectionMode,
      currentRepositoryUrl: context.currentRepositoryUrl,
      ...(context.requestedByGithubId === null
        ? {}
        : { auditActorGithubId: context.requestedByGithubId }),
      source,
      metadata,
    });
    return { repository, ownResolution };
  }

  private async processInvitations(
    invitations: readonly RepositoryInvitationWork[],
    repository: ProvisionedRepository,
    jobId: string,
    workerId: string,
    requestId: string,
    attemptCount: number,
    now: () => Date,
  ): Promise<void> {
    let retainedRevokeFailure: { readonly error: unknown } | null = null;
    for (const invitation of invitations) {
      if (invitation.intent !== 'REVOKE') {
        continue;
      }
      try {
        await this.jobs.renewLease(jobId, workerId, requestId, now());
        await this.github.revokeCollaborator(
          repository.name,
          invitation.githubLogin,
        );
        await this.state.completeInvitation({
          jobId,
          workerId,
          requestId,
          invitationId: invitation.id,
          repositoryId: repository.id,
          expectedStatus: invitation.status,
          status: RepositoryInvitationStatus.REVOKED,
          now: now(),
        });
      } catch (error) {
        if (
          error instanceof RepositoryProvisionLeaseLostError ||
          error instanceof RepositoryProvisionSupersededError
        ) {
          throw error;
        }
        await this.recordInvitationFailure(
          invitation,
          repository,
          jobId,
          workerId,
          requestId,
          attemptCount,
          error,
          now,
        );
        retainedRevokeFailure ??= { error };
      }
    }
    if (retainedRevokeFailure !== null) {
      throw retainedRevokeFailure.error;
    }
    for (const invitation of invitations) {
      if (invitation.intent !== 'GRANT') {
        continue;
      }
      try {
        await this.jobs.renewLease(jobId, workerId, requestId, now());
        const outcome = await this.github.ensureCollaborator(
          repository.name,
          invitation.githubLogin,
        );
        await this.state.completeInvitation({
          jobId,
          workerId,
          requestId,
          invitationId: invitation.id,
          repositoryId: repository.id,
          expectedStatus: invitation.status,
          status:
            outcome === COLLABORATOR_OUTCOMES.SUCCEEDED
              ? RepositoryInvitationStatus.SUCCEEDED
              : RepositoryInvitationStatus.PENDING,
          now: now(),
        });
      } catch (error) {
        if (
          error instanceof RepositoryProvisionLeaseLostError ||
          error instanceof RepositoryProvisionSupersededError
        ) {
          throw error;
        }
        await this.recordInvitationFailure(
          invitation,
          repository,
          jobId,
          workerId,
          requestId,
          attemptCount,
          error,
          now,
        );
        throw error;
      }
    }
  }

  private async recordInvitationFailure(
    invitation: RepositoryInvitationWork,
    repository: ProvisionedRepository,
    jobId: string,
    workerId: string,
    requestId: string,
    attemptCount: number,
    error: unknown,
    now: () => Date,
  ): Promise<void> {
    const failure = normalizeProvisionFailure(error);
    await this.state.failInvitation({
      jobId,
      workerId,
      requestId,
      invitationId: invitation.id,
      repositoryId: repository.id,
      expectedStatus: invitation.status,
      intent: invitation.intent,
      final: !failure.retryable || attemptCount >= this.options.maxAttempts,
      errorCode: failure.code,
      now: now(),
    });
  }

  private logResult(
    context: RepositoryProvisionContext,
    jobId: string,
    attempt: number,
    status: string,
  ): void {
    this.logger.log({
      event: 'repositories.provision.completed',
      eventId: context.requestId,
      jobId,
      applicationId: context.applicationId,
      attempt,
      status,
    });
  }
}
