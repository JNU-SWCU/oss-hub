import { Injectable } from '@nestjs/common';
import {
  CollectionRepositoryPresence,
  OutboxEventStatus,
  Prisma,
  RepositoryConnectionMode,
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
  canonicalGithubLogin,
  canonicalGithubLogins,
  claimedJobWhere,
  invitationIntent,
  isPrismaUniqueConstraintError,
  lockClaimedProvisionJob,
  loginsFromTeamMembers,
  matchesProvisionedMetadata,
  membershipFingerprint,
  PROVISION_MEMBERSHIP_UNAVAILABLE_ERROR_CODE,
  repositorySelection,
  RepositoryProvisionLeaseLostError,
  teamMemberLoginSelection,
  toProvisionedRepository,
} from '../repository-provision-state.helpers';
import type { ProvisionedRepositoryRow } from '../repository-provision-state.helpers';

/**
 * 회수 실패를 부여 실패 상태로 적으면 다음 사이클이 그 행을 "초대 재시도"로 읽어
 * 탈퇴한 구성원을 다시 초대한다 — 축(intent)별로 상태를 갈라 쓴다.
 */
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

/**
 * 멤버십이 작업 중 바뀌었을 때의 공통 결말 — 지금 다시 실행할 job 으로 되돌린다.
 * 직전 사이클의 실패 예산을 이어받지 않는다(attemptCount = 0).
 */
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
            repositoryConnectionMode: true,
            // 회수 판정의 유일한 authority는 live TeamMember 행이다 — leader/신청자를
            // 여기서 같이 읽어 fallback으로 섮어 넣으면 팀을 떠난 사람이 영원히
            // "현재 구성원"으로 남아 접근이 회수되지 않는다.
            team: {
              select: {
                name: true,
                members: { select: teamMemberLoginSelection },
              },
            },
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
    const team = application.team;
    if (
      team === null &&
      application.repositoryConnectionMode === RepositoryConnectionMode.NEW
    ) {
      // NEW 저장소는 팀 구성원 집합이 접근 권한의 원본이다. 그 원본을 읽을 수
      // 없는 채로 진행하면 빈 목록이 "전원 회수"로 해석된다 — fail closed.
      throw finalProvisionFailure(PROVISION_MEMBERSHIP_UNAVAILABLE_ERROR_CODE);
    }
    // OWN 경로는 초대 없이 본인 저장소를 연결할 뿐이라 팀이 없을 수 있다 —
    // 그 때도 신청자를 목록에 채우지 않고 빈 목록을 그대로 든다.
    const currentMemberGithubLogins =
      team === null ? [] : loginsFromTeamMembers(team.members);
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
      subjectName: team?.name ?? application.applicant.nickname,
      currentMemberGithubLogins,
      membershipFingerprint: membershipFingerprint(currentMemberGithubLogins),
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
    const desired = canonicalGithubLogins(githubLogins);
    await this.prisma.$transaction(async (transaction) => {
      await assertProvisionLease(transaction, jobId, workerId);
      // 저장된 login 은 과거 event payload 표기 그대로일 수 있어(대소문자 혼재)
      // DB 문자열 비교로 대조하면 같은 사람을 다른 사람으로 읽는다 — 정규화한
      // 값으로 메모리에서 대조하고 갱신은 id 로 건다.
      const rows = await transaction.repositoryInvitation.findMany({
        where: { repositoryId },
        select: { id: true, githubLogin: true, status: true },
      });
      const desiredSet = new Set(desired);
      const known = new Set(
        rows.map((row) => canonicalGithubLogin(row.githubLogin)),
      );
      const isRevocation = (status: RepositoryInvitationStatus): boolean =>
        invitationIntent(status) === 'REVOKE';
      // 1) 현재 구성원은 항상 행을 가진다(새 행은 PENDING 기본값).
      await transaction.repositoryInvitation.createMany({
        data: desired
          .filter((githubLogin) => !known.has(githubLogin))
          .map((githubLogin) => ({ repositoryId, githubLogin })),
        skipDuplicates: true,
      });
      // 2) 현재 구성원이 아닌데 아직 회수 축에 없는 행은 회수 대기로 옮긴다.
      //    이미 회수 축인 행(REVOKE_REQUIRED/REVOKED/REVOKE_FAILED_*)은 건드리지
      //    않는다 — 매 사이클 재무장하면 attemptCount가 리셋돼 최종 실패 예산이
      //    영원히 소진되지 않고, REVOKED 이력 행이 다시 회수 대상이 된다.
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
      // 3) 회수됐던 사람이 실제로 다시 합류한 경우에만 부여 축으로 되돌린다.
      //    GRANT 축의 FAILED_FINAL은 여기서 건드리지 않는다 — 구성원이 그대로인데
      //    재시도만 되살리면 영구 실패 판정이 의미를 잃는다.
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
    repositoryId: string,
  ): Promise<readonly RepositoryInvitationWork[]> {
    await assertProvisionLease(this.prisma, jobId, workerId);
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
          // 이미 회수한 행도 사이클마다 다시 확인한다. lease가 만료된 옛
          // worker가 회수 이후에 뒤늦게 부여를 성공시켰다면 GitHub 쪽에만
          // 협업자가 살아있고 DB는 REVOKED라 아무도 그걸 다시 보지 않는다 —
          // 회수는 멱등적이므로 재확인 비용만 낸다. 재합류한 사람은
          // prepareInvitations가 이미 PENDING으로 돌려놓으므로 여기 남은 REVOKED는
          // 모두 "현재 구성원이 아닌 사람"이다.
          { status: RepositoryInvitationStatus.REVOKED },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, githubLogin: true, status: true },
    });
    // 회수를 먼저 처리한다 — 부여 쪽이 GitHub 오류로 중단되더라도 이미 팀을 떠난
    // 사람의 접근이 다음 사이클까지 남아 있지 않게 한다. Prisma orderBy로는 상태별
    // 우선순위를 표현할 수 없어 조회 순서(createdAt,id)를 유지한 채 안정 정렬한다.
    const work = rows.map((row) => ({
      id: row.id,
      githubLogin: row.githubLogin,
      status: row.status,
      intent: invitationIntent(row.status),
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
      await assertProvisionLease(transaction, input.jobId, input.workerId);
      // CAS — worker가 읽은 시점의 상태와 저장소까지 함께 맞추어야 쓴다. 사이에
      // 멤버십이 바뀌어 행이 REVOKE_REQUIRED로 옮겨갔다면 늦게 도착한 부여 결과가
      // 그 회수 지시를 덮어쓰면 안 된다.
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
      assertSingleProvisionUpdate(updated.count);
    });
  }

  /**
   * 부여/회수를 다 돌린 뒤 완료 처리한다. GitHub 호출 동안 팀 구성원이 바뀔 수
   * 있으므로, 작업 시작 시점의 멤버십 지문과 지금 값을 비교해 다르면 SUCCEEDED로
   * 닫지 않고 즉시 재무장한다 — 그렇지 않으면 방금 탈퇴한 구성원의 접근이 다음
   * 정기 사이클까지 그대로 살아 있게 된다.
   *
   * 잠금 순서: Job 행만 잠그고 TeamMember는 잠금 없이 다시 읽는다. 멤버십 쓰기
   * 경로는 Team → (outbox/job) 순서로 가므로 여기서 Job → Team 으로 잠그면
   * 순환 대기가 된다. 트랜잭션 안에서 GitHub 호출은 하지 않는다.
   */
  async completeJob(
    jobId: string,
    workerId: string,
    repositoryId: string,
    now: Date,
    nextReconciliationAt?: Date,
    expectedMembershipFingerprint?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const { applicationId } = await lockClaimedProvisionJob(
        transaction,
        jobId,
        workerId,
      );
      const stale =
        expectedMembershipFingerprint === undefined
          ? false
          : (await this.currentMembershipFingerprint(
              transaction,
              applicationId,
            )) !== expectedMembershipFingerprint;
      const updated = await transaction.repositoryProvisionJob.updateMany({
        where: claimedJobWhere(jobId, workerId),
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
      assertSingleProvisionUpdate(updated.count);
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
      return membershipFingerprint([]);
    }
    const members = await transaction.teamMember.findMany({
      where: { teamId: application.teamId },
      select: teamMemberLoginSelection,
    });
    return membershipFingerprint(loginsFromTeamMembers(members));
  }

  /**
   * 실패도 완료와 같은 멤버십 가드를 거친다. outbox 는 PROCESSING job 의 lease 를
   * 손대지 않고 지나가므로, 작업 중 도착한 멤버십 변경은 그 행에 흔적을 남기지
   * 못한다 — 여기서 FAILED_FINAL 로 닫아 버리면 그 변경 신호가 통째로 사라지고
   * 탈퇴자 접근이 영구히 남는다. 지문이 어긋나면 지난 실패 대신 재무장이 맞다.
   */
  async failJob(input: FailRepositoryProvisionJobInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const { applicationId } = await lockClaimedProvisionJob(
        transaction,
        input.jobId,
        input.workerId,
      );
      const stale =
        input.expectedMembershipFingerprint === undefined
          ? false
          : (await this.currentMembershipFingerprint(
              transaction,
              applicationId,
            )) !== input.expectedMembershipFingerprint;
      const updated = await transaction.repositoryProvisionJob.updateMany({
        where: claimedJobWhere(input.jobId, input.workerId),
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
      assertSingleProvisionUpdate(updated.count);
    });
  }
}
