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
  type OwnGithubRepositoryResolution,
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
      | 'findPublicRepository'
      | 'organization'
    >,
    /**
     * OWN 저장소를 수집 큐에 편입한다. 프로비저닝(recordRepository)과 수집 관찰은
     * 같은 GithubRepository 행에 쓰지만 책임이 다르다(#617 단계 D 이후에도) —
     * recordRepository는 provision 컬럼만, 이건 수집 관찰 필드만 갱신한다.
     * 여기서 잇지 않으면 OWN 저장소는 수집 스윕 대상에서 영영 빠진다(ADR-010 §6).
     */
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

    try {
      const context = await this.state.loadContext(job.id, workerId);
      const { logins, connectionMode, repositoryUrl } =
        this.validateContext(context);
      const prepared: PreparedRepository =
        context.repository === null
          ? await this.createAndRecordRepository(
              context,
              connectionMode,
              repositoryUrl,
              job.id,
              workerId,
              now,
            )
          : { repository: context.repository, ownResolution: null };
      const repository = prepared.repository;
      if (connectionMode === 'OWN') {
        const completedAt = now();
        const resolution =
          prepared.ownResolution ??
          (await resolveOwnGithubRepository(this.github, repositoryUrl ?? ''));
        const metadata = resolution.repository;
        if (metadata.githubRepositoryId !== repository.githubRepositoryId) {
          throw finalProvisionFailure(
            PROVISION_ERROR_CODES.REPOSITORY_MISMATCH,
          );
        }
        if (resolution.kind === 'EXTERNAL') {
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
  ): Promise<PreparedRepository> {
    await this.jobs.renewLease(jobId, workerId, now());
    const ownResolution =
      connectionMode === 'OWN'
        ? await resolveOwnGithubRepository(
            this.github,
            // 레거시/손상 payload 방어: OWN이면 URL 필수.
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
    // OWN + EXTERNAL(조직 밖 공개 저장소)만 EXTERNAL_PUBLIC이다. NEW든
    // OWN + ORGANIZATION(조직 안 저장소를 자기 것으로 연결)이든 조직이 관리하는
    // 저장소이므로 ORG_PROVISIONED다 — 여기서 잘못 찍으면 뒤이은
    // enrollExternalRepository가 이 행을 "이미 다른 source로 있음"으로 보고
    // 수집 관찰 필드를 갱신하지 않는다.
    const source =
      ownResolution?.kind === 'EXTERNAL'
        ? RepositorySource.EXTERNAL_PUBLIC
        : RepositorySource.ORG_PROVISIONED;
    const repository = await this.state.recordRepository({
      jobId,
      workerId,
      applicationId: context.applicationId,
      programId: context.programId,
      teamId: context.teamId,
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
