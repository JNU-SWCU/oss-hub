import { Injectable } from '@nestjs/common';
import {
  CollectionRepositoryPresence,
  OutboxEventStatus,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { REPOSITORY_PROVISION_EVENT_TYPE } from '../repository-provision-event';
import type {
  CompleteRepositoryInvitationInput,
  FailRepositoryInvitationInput,
  FailRepositoryProvisionJobInput,
  ProvisionedRepository,
  RecordProvisionedRepositoryInput,
  RepositoryInvitationWork,
  RepositoryProvisionContext,
  RepositoryProvisionStateStore,
} from '../repository-provision.contract';
import {
  finalProvisionFailure,
  PROVISION_ERROR_CODES,
} from '../repository-provision.failure';
import { DEFAULT_PROVISION_MAX_INVITATION_RECONCILIATIONS } from '../repository-provision.failure';
import {
  assertProvisionLease,
  assertSingleProvisionUpdate,
  claimedJobWhere,
  isPrismaUniqueConstraintError,
  matchesProvisionedMetadata,
  repositorySelection,
  RepositoryProvisionLeaseLostError,
  toProvisionedRepository,
} from '../repository-provision-state.helpers';
import type { ProvisionedRepositoryRow } from '../repository-provision-state.helpers';

@Injectable()
export class RepositoryProvisionStateRepository implements RepositoryProvisionStateStore {
  constructor(private readonly prisma: PrismaService) {}

  async loadContext(
    jobId: string,
    workerId: string,
  ): Promise<RepositoryProvisionContext> {
    const job = await this.prisma.repositoryProvisionJob.findFirst({
      where: claimedJobWhere(jobId, workerId),
      select: {
        application: {
          select: {
            id: true,
            status: true,
            programId: true,
            teamId: true,
            applicant: { select: { githubId: true, nickname: true } },
            program: {
              select: {
                name: true,
                repositoryProvisioningEnabled: true,
              },
            },
            team: { select: { name: true } },
            repository: { select: repositorySelection },
          },
        },
      },
    });
    if (job === null) {
      throw new RepositoryProvisionLeaseLostError();
    }
    const application = job.application;
    const event = await this.prisma.outboxEvent.findFirst({
      where: {
        type: REPOSITORY_PROVISION_EVENT_TYPE,
        aggregateType: 'Application',
        aggregateId: application.id,
        status: OutboxEventStatus.PROCESSED,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, payload: true },
    });
    if (event === null) {
      throw finalProvisionFailure(PROVISION_ERROR_CODES.INVALID_EVENT);
    }
    return {
      eventId: event.id,
      eventPayload: event.payload,
      applicationId: application.id,
      applicantGithubId: application.applicant.githubId,
      applicationStatus: application.status,
      programId: application.programId,
      programName: application.program.name,
      repositoryProvisioningEnabled:
        application.program.repositoryProvisioningEnabled,
      teamId: application.teamId,
      subjectName: application.team?.name ?? application.applicant.nickname,
      repository:
        application.repository === null
          ? null
          : toProvisionedRepository(application.repository),
    };
  }

  async recordRepository(
    input: RecordProvisionedRepositoryInput,
  ): Promise<ProvisionedRepository> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await assertProvisionLease(transaction, input.jobId, input.workerId);
        // GithubRepository에 직접 upsert한다(#617 단계 D) — 여기서 쓰는 건 provision
        // 컬럼(applicationId/programId/teamId) + source/presence뿐이다. 수집 큐 필드
        // (nextRunAt/lastSuccessAt/failureCount)는 create에서 스키마 기본값을 그대로 받고,
        // update에서는 절대 건드리지 않는다(인벤토리 스윕과 동일한 원칙).
        // source는 호출자가 넘긴 값을 그대로 쓴다 — OWN+EXTERNAL 연결을 여기서
        // ORG_PROVISIONED로 잘못 찍으면, 뒤이은 enrollExternalRepository가
        // "이미 다른 source로 있는 행"으로 보고 조용히 아무것도 안 한다.
        //
        // org sweep(collection-sync.service.ts)이 이 githubRepositoryId를 이미
        // `applicationId: null`로 관찰해 놨을 수 있다(OWN+ORGANIZATION). 그 경우
        // applicationId 기준 upsert는 항상 create로 떨어지고, githubRepositoryId
        // unique 제약과 충돌해 REPOSITORY_MISMATCH로 영구 실패한다 — 그 행을
        // 새로 만드는 대신 채택(adopt)한다. `applicationId: null` 조건을 건 채로
        // updateMany해 동시에 다른 job이 같은 행을 먼저 채택하는 경쟁을 막는다
        // (0건이면 진짜 충돌로 취급).
        const swept = await transaction.githubRepository.findUnique({
          where: { githubRepositoryId: input.metadata.githubRepositoryId },
          select: { id: true, applicationId: true },
        });
        let repository: ProvisionedRepositoryRow;
        if (swept !== null && swept.applicationId === null) {
          const adopted = await transaction.githubRepository.updateMany({
            where: { id: swept.id, applicationId: null },
            data: {
              applicationId: input.applicationId,
              programId: input.programId,
              teamId: input.teamId,
              nameWithOwner: input.metadata.nameWithOwner,
              visibility: input.metadata.visibility,
              source: input.source,
              presence: CollectionRepositoryPresence.PRESENT,
            },
          });
          if (adopted.count !== 1) {
            throw finalProvisionFailure(
              PROVISION_ERROR_CODES.REPOSITORY_MISMATCH,
            );
          }
          repository = await transaction.githubRepository.findUniqueOrThrow({
            where: { id: swept.id },
            select: repositorySelection,
          });
        } else {
          repository = await transaction.githubRepository.upsert({
            where: { applicationId: input.applicationId },
            update: {},
            create: {
              applicationId: input.applicationId,
              programId: input.programId,
              teamId: input.teamId,
              githubRepositoryId: input.metadata.githubRepositoryId,
              nameWithOwner: input.metadata.nameWithOwner,
              visibility: input.metadata.visibility,
              source: input.source,
              presence: CollectionRepositoryPresence.PRESENT,
            },
            select: repositorySelection,
          });
        }
        const provisioned = toProvisionedRepository(repository);
        if (!matchesProvisionedMetadata(provisioned, input)) {
          throw finalProvisionFailure(
            PROVISION_ERROR_CODES.REPOSITORY_MISMATCH,
          );
        }
        const attached = await transaction.repositoryProvisionJob.updateMany({
          where: claimedJobWhere(input.jobId, input.workerId),
          data: { repositoryId: provisioned.id },
        });
        assertSingleProvisionUpdate(attached.count);
        return provisioned;
      });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw finalProvisionFailure(PROVISION_ERROR_CODES.REPOSITORY_MISMATCH);
      }
      throw error;
    }
  }

  async prepareInvitations(
    jobId: string,
    workerId: string,
    repositoryId: string,
    githubLogins: readonly string[],
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await assertProvisionLease(transaction, jobId, workerId);
      await transaction.repositoryInvitation.createMany({
        data: githubLogins.map((githubLogin) => ({
          repositoryId,
          githubLogin,
        })),
        skipDuplicates: true,
      });
    });
  }

  async findInvitationWork(
    jobId: string,
    workerId: string,
    repositoryId: string,
  ): Promise<readonly RepositoryInvitationWork[]> {
    await assertProvisionLease(this.prisma, jobId, workerId);
    return this.prisma.repositoryInvitation.findMany({
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
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, githubLogin: true },
    });
  }

  async completeInvitation(
    input: CompleteRepositoryInvitationInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await assertProvisionLease(transaction, input.jobId, input.workerId);
      const updated = await transaction.repositoryInvitation.updateMany({
        where: { id: input.invitationId },
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
      assertSingleProvisionUpdate(updated.count);
      if (input.status !== RepositoryInvitationStatus.PENDING) {
        return;
      }
      // 확인 예산(15분 × 96회 = 24시간)을 다 쓴 PENDING 은 최종 실패로 종료한다.
      // 종료하지 않으면 findInvitationWork 의 조회 조건에서만 빠지고 상태는 PENDING 으로
      // 영구 잔류해, 학생 화면이 「초대 수락 대기」를 계속 보여 준다 —
      // 시스템이 확인을 포기한 것과 아직 처리 중인 것을 구분할 수 없다.
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
      await assertProvisionLease(transaction, input.jobId, input.workerId);
      const updated = await transaction.repositoryInvitation.updateMany({
        where: { id: input.invitationId },
        data: {
          status: input.final
            ? RepositoryInvitationStatus.FAILED_FINAL
            : RepositoryInvitationStatus.FAILED_RETRYABLE,
          attemptCount: { increment: 1 },
          lastErrorCode: input.errorCode,
          lastErrorMessage: null,
          processedAt: input.now,
        },
      });
      assertSingleProvisionUpdate(updated.count);
    });
  }

  async completeJob(
    jobId: string,
    workerId: string,
    repositoryId: string,
    now: Date,
    nextReconciliationAt?: Date,
  ): Promise<void> {
    const updated = await this.prisma.repositoryProvisionJob.updateMany({
      where: claimedJobWhere(jobId, workerId),
      data: {
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
    assertSingleProvisionUpdate(updated.count);
  }

  async failJob(input: FailRepositoryProvisionJobInput): Promise<void> {
    const updated = await this.prisma.repositoryProvisionJob.updateMany({
      where: claimedJobWhere(input.jobId, input.workerId),
      data: {
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
    assertSingleProvisionUpdate(updated.count);
  }
}
