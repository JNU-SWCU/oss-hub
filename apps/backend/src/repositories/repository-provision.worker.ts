import { Logger } from '@nestjs/common';
import { ApplicationStatus, RepositoryInvitationStatus } from '@prisma/client';
import {
  COLLABORATOR_OUTCOMES,
  type GithubAppClient,
} from './github-app.client';
import type { RepositoryProvisionJobRepository } from './repository-provision-job.repository';
import {
  InvalidRepositoryProvisionEventError,
  parseRepositoryProvisionEvent,
} from './repository-provision-event';
import type {
  ProvisionedRepository,
  RepositoryInvitationWork,
  RepositoryProvisionContext,
  RepositoryProvisionStateStore,
} from './repository-provision.contract';
import {
  DEFAULT_PROVISION_OPTIONS,
  finalProvisionFailure,
  normalizeProvisionFailure,
  PROVISION_ERROR_CODES,
  provisionRetryAt,
  type RepositoryProvisionWorkerOptions,
} from './repository-provision.failure';
import { findOrCreateGithubRepository } from './repository-provision.github';
import { buildRepositoryNames } from './repository-name';

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
    };

export class RepositoryProvisionWorker {
  private readonly logger = new Logger(RepositoryProvisionWorker.name);

  constructor(
    private readonly jobs: Pick<RepositoryProvisionJobRepository, 'claimNext'>,
    private readonly state: RepositoryProvisionStateStore,
    private readonly github: Pick<
      GithubAppClient,
      'findRepository' | 'createRepository' | 'ensureCollaborator'
    >,
    private readonly options: RepositoryProvisionWorkerOptions = DEFAULT_PROVISION_OPTIONS,
  ) {}

  async runNext(
    workerId: string,
    now = new Date(),
  ): Promise<RepositoryProvisionResult> {
    const job = await this.jobs.claimNext({
      workerId,
      now,
      leaseMs: this.options.leaseMs,
    });
    if (job === null) {
      return { kind: 'EMPTY' };
    }

    try {
      const context = await this.state.loadContext(job.id, workerId);
      const logins = this.validateContext(context);
      const repository =
        context.repository ??
        (await this.createAndRecordRepository(context, job.id, workerId));
      await this.state.prepareInvitations(
        job.id,
        workerId,
        repository.id,
        logins,
      );
      const invitations = await this.state.findInvitationWork(
        job.id,
        workerId,
        repository.id,
      );
      await this.processInvitations(
        invitations,
        repository,
        job.id,
        workerId,
        job.attemptCount,
        now,
      );
      await this.state.completeJob(job.id, workerId, repository.id, now);
      this.logResult(context, job.id, job.attemptCount, 'SUCCEEDED');
      return { kind: 'SUCCEEDED', jobId: job.id, repositoryId: repository.id };
    } catch (error) {
      const failure = normalizeProvisionFailure(error);
      const final =
        !failure.retryable || job.attemptCount >= this.options.maxAttempts;
      await this.state.failJob({
        jobId: job.id,
        workerId,
        final,
        errorCode: failure.code,
        nextAttemptAt: final
          ? now
          : provisionRetryAt(
              failure,
              job.attemptCount,
              now,
              this.options.retryBaseMs,
            ),
        now,
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

  private validateContext(
    context: RepositoryProvisionContext,
  ): readonly string[] {
    if (context.applicationStatus !== ApplicationStatus.APPROVED) {
      throw finalProvisionFailure(
        PROVISION_ERROR_CODES.APPLICATION_NOT_APPROVED,
      );
    }
    if (!context.repositoryProvisioningEnabled) {
      throw finalProvisionFailure(PROVISION_ERROR_CODES.FEATURE_DISABLED);
    }
    try {
      const event = parseRepositoryProvisionEvent(context.eventPayload);
      if (
        event.applicationId !== context.applicationId ||
        event.programId !== context.programId ||
        event.teamId !== context.teamId
      ) {
        throw new InvalidRepositoryProvisionEventError();
      }
      return event.collaboratorGithubLogins;
    } catch (error) {
      if (error instanceof InvalidRepositoryProvisionEventError) {
        throw finalProvisionFailure(PROVISION_ERROR_CODES.INVALID_EVENT);
      }
      throw error;
    }
  }

  private async createAndRecordRepository(
    context: RepositoryProvisionContext,
    jobId: string,
    workerId: string,
  ): Promise<ProvisionedRepository> {
    const names = buildRepositoryNames({
      programName: context.programName,
      programId: context.programId,
      subjectName: context.subjectName,
      applicationId: context.applicationId,
    });
    const metadata = await findOrCreateGithubRepository(this.github, names);
    return this.state.recordRepository({
      jobId,
      workerId,
      applicationId: context.applicationId,
      programId: context.programId,
      teamId: context.teamId,
      metadata,
    });
  }

  private async processInvitations(
    invitations: readonly RepositoryInvitationWork[],
    repository: ProvisionedRepository,
    jobId: string,
    workerId: string,
    attemptCount: number,
    now: Date,
  ): Promise<void> {
    for (const invitation of invitations) {
      try {
        const outcome = await this.github.ensureCollaborator(
          repository.name,
          invitation.githubLogin,
        );
        await this.state.completeInvitation({
          jobId,
          workerId,
          invitationId: invitation.id,
          status:
            outcome === COLLABORATOR_OUTCOMES.SUCCEEDED
              ? RepositoryInvitationStatus.SUCCEEDED
              : RepositoryInvitationStatus.PENDING,
          now,
        });
      } catch (error) {
        const failure = normalizeProvisionFailure(error);
        await this.state.failInvitation({
          jobId,
          workerId,
          invitationId: invitation.id,
          final: !failure.retryable || attemptCount >= this.options.maxAttempts,
          errorCode: failure.code,
          now,
        });
        throw error;
      }
    }
  }

  private logResult(
    context: RepositoryProvisionContext,
    jobId: string,
    attempt: number,
    status: string,
  ): void {
    this.logger.log({
      event: 'repositories.provision.completed',
      eventId: context.eventId,
      jobId,
      applicationId: context.applicationId,
      attempt,
      status,
    });
  }
}
