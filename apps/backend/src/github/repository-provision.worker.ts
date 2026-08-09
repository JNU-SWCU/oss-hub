import { Logger } from '@nestjs/common';
import { ApplicationStatus, RepositoryInvitationStatus } from '@prisma/client';
import {
  COLLABORATOR_OUTCOMES,
  type GithubAppClient,
} from './github-app.client';
import type { RepositoryProvisionJobRepository } from './repository/repository-provision-job.repository';
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
} from './repository-provision.github';
import {
  buildRepositoryNames,
  buildRepositoryOwnershipMarker,
} from './repository-name';
import { RepositoryProvisionLeaseLostError } from './repository-provision-state.helpers';

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
      | 'findPublicRepository'
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

    try {
      const context = await this.state.loadContext(job.id, workerId);
      const { logins, connectionMode, repositoryUrl } =
        this.validateContext(context);
      const repository =
        context.repository ??
        (await this.createAndRecordRepository(
          context,
          connectionMode,
          repositoryUrl,
          job.id,
          workerId,
          now,
        ));
      // OWN은 조직 밖 저장소라 초대 권한이 없다 — 초대 단계를 통째로 건너뛴다.
      if (connectionMode === 'OWN') {
        const completedAt = now();
        await this.state.completeJob(
          job.id,
          workerId,
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
        repository.id,
        logins,
      );
      const invitations = await this.state.findInvitationWork(
        job.id,
        workerId,
        repository.id,
      );
      const hasPendingInvitation = await this.processInvitations(
        invitations,
        repository,
        job.id,
        workerId,
        job.attemptCount,
        now,
      );
      const completedAt = now();
      await this.state.completeJob(
        job.id,
        workerId,
        repository.id,
        completedAt,
        hasPendingInvitation
          ? new Date(
              completedAt.getTime() +
                DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
            )
          : undefined,
      );
      this.logResult(context, job.id, job.attemptCount, 'SUCCEEDED');
      return { kind: 'SUCCEEDED', jobId: job.id, repositoryId: repository.id };
    } catch (error) {
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
    readonly logins: readonly string[];
    readonly connectionMode: 'NEW' | 'OWN';
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
    try {
      const event = parseRepositoryProvisionEvent(context.eventPayload);
      // 백필 이전에 기록된 PENDING 이벤트는 teamId가 null이다.
      if (
        event.applicationId !== context.applicationId ||
        event.programId !== context.programId ||
        (event.teamId !== null && event.teamId !== context.teamId)
      ) {
        throw new InvalidRepositoryProvisionEventError();
      }
      return {
        logins: event.collaboratorGithubLogins,
        connectionMode: event.repositoryConnectionMode,
        repositoryUrl: event.repositoryUrl,
      };
    } catch (error) {
      if (error instanceof InvalidRepositoryProvisionEventError) {
        throw finalProvisionFailure(PROVISION_ERROR_CODES.INVALID_EVENT);
      }
      throw error;
    }
  }

  private async createAndRecordRepository(
    context: RepositoryProvisionContext,
    connectionMode: 'NEW' | 'OWN',
    repositoryUrl: string | null,
    jobId: string,
    workerId: string,
    now: () => Date,
  ): Promise<ProvisionedRepository> {
    await this.jobs.renewLease(jobId, workerId, now());
    const metadata =
      connectionMode === 'OWN'
        ? await resolveOwnGithubRepository(
            this.github,
            // 레거시/손상 payload 방어: OWN이면 URL 필수.
            repositoryUrl ?? '',
          )
        : await findOrCreateGithubRepository(
            this.github,
            buildRepositoryNames({
              programName: context.programName,
              programId: context.programId,
              subjectName: context.subjectName,
              applicationId: context.applicationId,
            }),
            buildRepositoryOwnershipMarker(context.applicationId),
          );
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
    now: () => Date,
  ): Promise<boolean> {
    let hasPendingInvitation = false;
    for (const invitation of invitations) {
      try {
        await this.jobs.renewLease(jobId, workerId, now());
        const outcome = await this.github.ensureCollaborator(
          repository.name,
          invitation.githubLogin,
        );
        const status =
          outcome === COLLABORATOR_OUTCOMES.SUCCEEDED
            ? RepositoryInvitationStatus.SUCCEEDED
            : RepositoryInvitationStatus.PENDING;
        await this.state.completeInvitation({
          jobId,
          workerId,
          invitationId: invitation.id,
          status,
          now: now(),
        });
        if (status === RepositoryInvitationStatus.PENDING) {
          hasPendingInvitation = true;
        }
      } catch (error) {
        if (error instanceof RepositoryProvisionLeaseLostError) {
          throw error;
        }
        const failure = normalizeProvisionFailure(error);
        await this.state.failInvitation({
          jobId,
          workerId,
          invitationId: invitation.id,
          final: !failure.retryable || attemptCount >= this.options.maxAttempts,
          errorCode: failure.code,
          now: now(),
        });
        throw error;
      }
    }
    return hasPendingInvitation;
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
