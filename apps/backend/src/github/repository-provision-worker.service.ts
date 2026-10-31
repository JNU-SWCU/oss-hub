import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  ApplicationStatus,
  RepositoryInvitationStatus,
  RepositorySource,
} from '@prisma/client';
import { COLLABORATOR_OUTCOMES, GithubAppClient } from './github-app.client';
import { RepositoryOwnEnrollmentService } from './repositories.service';
import { RepositoryProvisionJobRepository } from './repository-provision-job.repository';
import { RepositoryProvisionStateService } from './repository-provision-state.service';
import { RepositoryProvisionGithubService } from './repository-provision-github.service';
import { type OwnGithubRepositoryResolution } from './own-repository-resolution.types';
import {
  RepositoryProvisionLeaseLostError,
  RepositoryProvisionSupersededError,
  RepositoryProvisionFailure,
} from './repository-provision-state.error';
import {
  type ProvisionedRepository,
  type RepositoryInvitationWork,
  type RepositoryProvisionContext,
} from './repository-provision-state.repository';

import {
  DEFAULT_PROVISION_OPTIONS,
  DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
  PROVISION_ERROR_CODES,
  PROVISION_WORKER_OPTIONS,
  type RepositoryProvisionWorkerOptions,
} from './repository-provision-state.config';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { GithubOperationsError } from './github-app.error';

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

@Injectable()
export class RepositoryProvisionWorkerService {
  private readonly logger = new Logger(RepositoryProvisionWorkerService.name);

  constructor(
    private readonly jobs: RepositoryProvisionJobRepository,
    private readonly state: RepositoryProvisionStateService,
    private readonly github: GithubAppClient,
    private readonly collectionEnrollment: RepositoryOwnEnrollmentService,
    private readonly auditLogMetadataService: AuditLogMetadataService,
    private readonly repositoryProvisionGithubService: RepositoryProvisionGithubService,
    @Optional()
    @Inject(PROVISION_WORKER_OPTIONS)
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
        throw RepositoryProvisionFailure.final(
          PROVISION_ERROR_CODES.REPOSITORY_MISMATCH,
        );
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
            throw RepositoryProvisionFailure.final(
              PROVISION_ERROR_CODES.REPOSITORY_MISMATCH,
            );
          }

          if (resolution.kind !== 'EXTERNAL') {
            throw RepositoryProvisionFailure.final(
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
      const failure = this.normalizeProvisionFailure(error);
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
          : this.provisionRetryAt(
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
      throw RepositoryProvisionFailure.final(
        PROVISION_ERROR_CODES.APPLICATION_NOT_APPROVED,
      );
    }
    if (!context.repositoryProvisioningEnabled) {
      throw RepositoryProvisionFailure.final(
        PROVISION_ERROR_CODES.FEATURE_DISABLED,
      );
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
    throw RepositoryProvisionFailure.final(
      PROVISION_ERROR_CODES.REPOSITORY_MISMATCH,
    );
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
      throw RepositoryProvisionFailure.final(
        PROVISION_ERROR_CODES.INVALID_EVENT,
      );
    }
    const current = reloaded.repository;
    if (
      current === null ||
      reloaded.currentRepositorySource === null ||
      current.id !== recorded.id ||
      current.githubRepositoryId !== recorded.githubRepositoryId ||
      current.applicationId !== claimed.applicationId
    ) {
      throw RepositoryProvisionFailure.final(
        PROVISION_ERROR_CODES.REPOSITORY_MISMATCH,
      );
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
        ? await this.repositoryProvisionGithubService.resolveOwnGithubRepository(
            this.github,

            repositoryUrl ?? '',
          )
        : null;
    const metadata =
      ownResolution?.repository ??
      (await this.repositoryProvisionGithubService.findOrCreateGithubRepository(
        this.github,
        this.repositoryProvisionGithubService.buildRepositoryNames({
          programName: context.programName,
          programId: context.programId,
          subjectName: context.subjectName,
          applicationId: context.applicationId,
        }),
        this.repositoryProvisionGithubService.buildRepositoryOwnershipMarker(
          context.applicationId,
        ),
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
        : {
            connectionAudit: {
              actorGithubId: context.requestedByGithubId,
              buildMetadata: (change) =>
                this.auditLogMetadataService.createRepositoryConnectionAuditMetadata(
                  change,
                ),
            },
          }),
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
    const failure = this.normalizeProvisionFailure(error);
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

  private normalizeProvisionFailure(
    error: unknown,
  ): RepositoryProvisionFailure {
    if (error instanceof GithubOperationsError) {
      return new RepositoryProvisionFailure(
        error.code,
        error.retryable,
        error.retryAt,
      );
    }
    if (error instanceof RepositoryProvisionFailure) {
      return error;
    }
    return new RepositoryProvisionFailure(PROVISION_ERROR_CODES.INTERNAL, true);
  }

  private provisionRetryAt(
    failure: RepositoryProvisionFailure,
    attempt: number,
    now: Date,
    baseMs: number,
  ): Date {
    if (failure.retryAt !== null && failure.retryAt.getTime() > now.getTime()) {
      return failure.retryAt;
    }
    return new Date(now.getTime() + baseMs * 2 ** Math.max(0, attempt - 1));
  }
}
