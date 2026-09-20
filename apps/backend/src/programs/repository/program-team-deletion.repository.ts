import { Injectable } from '@nestjs/common';
import { Prisma, SubmissionFileLifecycle } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../../audit-log/audit-log.repository';
import { isSerializationFailure } from '../../common/prisma-serialization-retry';
import { PrismaService } from '../../prisma/prisma.service';
import {
  readTeamDeletionScopeCounts,
  sameTeamDeletionScopeCountValues,
  sameTeamDeletionScopeCounts,
  type TeamDeletionScopeCounts,
} from '../team-deletion-scope';

/**
 * 삭제된 행 수. `TeamDeletionScopeCounts`에서 지문만 뺀 모양이어야 한다 — 확인 화면이
 * 본 수치와 실제로 지운 수치를 같은 축으로 대조하기 위해서다.
 */
export type TeamDeletedCounts = Omit<
  TeamDeletionScopeCounts,
  'scopeFingerprint'
>;

/** 감사에 필요한 사실 — 팀 행을 잠그고 읽은 값만 담는다. */
export interface TeamDeletionAuditEvent {
  readonly teamId: string;
  readonly programName: string;
  readonly teamName: string;
  readonly deletedCounts: TeamDeletedCounts;
}

export interface TeamDeletionAuditStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
}

/**
 * 삭제와 같은 트랜잭션에서 감사를 남기는 필수 콜백. 콜백이 던지면 삭제 전체가 롤백된다.
 */
export type RecordTeamDeletionAudit = (
  store: TeamDeletionAuditStore,
  event: TeamDeletionAuditEvent,
) => Promise<void>;

/**
 * 삭제 결과. `not-found`는 없는 팀과 다른 프로그램의 팀을 구분하지 않는다 —
 * 구분해 응답하면 남의 프로그램에 그 id의 팀이 있다는 사실이 샌다.
 */
export type TeamDeletionResult =
  | { readonly outcome: 'deleted'; readonly deletedCounts: TeamDeletedCounts }
  | { readonly outcome: 'not-found' }
  | {
      readonly outcome: 'scope-changed';
      readonly currentScopeCounts: TeamDeletionScopeCounts;
    };

class TeamDeletedScopeMismatchError extends Error {
  constructor() {
    super('Team deletion deleted counts differ from its confirmed scope.');
    this.name = 'TeamDeletedScopeMismatchError';
  }
}

/**
 * 교직원 팀 삭제의 Prisma 경계.
 *
 * 삭제 순서는 `TEAM_PURGE_DELETION_ORDER`가 `PROGRAM_PURGE_DELETION_ORDER`에서 좁혀 온
 * 그대로다 — outbox·알림 → 저장소 DETACH → provision job → 제출 파일 DETACH →
 * 검토 이력 → 제출 이력 → 제출 → application → teamInvitation → teamMember → team.
 * `program-purge-deletion-matrix.spec.ts`의 team 계약 테스트가 이 순서를 고정한다.
 *
 * `Application.team`의 `onDelete: Restrict`는 삭제 금지가 아니라 **순서 요구**다 —
 * 신청을 먼저 지우면 팀을 지울 수 있다. 팀 삭제는 탈퇴 경로의 「신청 기록이 있는 팀의
 * 마지막 구성원은 나갈 수 없다」와 다른 계열이다: 그쪽은 학생이 신청 이력을 남기고
 * 빠져나가는 것을 막는 규칙이고, 이쪽은 교직원이 그 이력까지 함께 거두는 경로다.
 */
@Injectable()
export class ProgramTeamDeletionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 확인 화면이 보여줄 범위. 삭제 트랜잭션과 같은 쿼리를 단일 읽기 트랜잭션으로 감싼다. */
  readScopeCounts(teamId: string): Promise<TeamDeletionScopeCounts> {
    return this.prisma.$transaction((transaction) =>
      readTeamDeletionScopeCounts(transaction, teamId),
    );
  }

  /**
   * 팀과 그 아래 전부를 한 트랜잭션에서 지운다.
   *
   * 확인 화면이 본 `expectedScope`를 트랜잭션 **안에서** 같은 스냅샷 쿼리로 다시 읽어
   * 비교하고, 어긋나면 아무것도 지우지 않고 물러난다(#F2 TOCTOU). 팀 행을 먼저
   * `FOR UPDATE`로 잠그는 것은 `leave`·`removeMember`·`renameTeam`과 같은 순서이고,
   * 잠금이 막지 못하는 자식 행의 동시 생성은 Serializable 격리와 아래 P2003 분류가 받는다.
   */
  async deleteTeam(
    programId: string,
    teamId: string,
    expectedScope: TeamDeletionScopeCounts,
    recordAudit: RecordTeamDeletionAudit,
  ): Promise<TeamDeletionResult> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`;

          const team = await tx.team.findUnique({
            where: { id: teamId },
            select: {
              programId: true,
              name: true,
              program: { select: { name: true } },
            },
          });
          if (!team || team.programId !== programId) {
            return { outcome: 'not-found' as const };
          }

          const currentScopeCounts = await readTeamDeletionScopeCounts(
            tx,
            teamId,
          );
          if (!sameTeamDeletionScopeCounts(expectedScope, currentScopeCounts)) {
            return {
              outcome: 'scope-changed' as const,
              currentScopeCounts,
            };
          }

          const deletedCounts = await deleteTeamTree(tx, teamId);
          if (
            !sameTeamDeletionScopeCountValues(currentScopeCounts, deletedCounts)
          ) {
            throw new TeamDeletedScopeMismatchError();
          }
          await tx.team.delete({ where: { id: teamId } });

          await recordAudit(
            { auditLogWriter: tx },
            {
              teamId,
              programName: team.program.name,
              teamName: team.name,
              deletedCounts,
            },
          );

          return { outcome: 'deleted' as const, deletedCounts };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // 직렬화 실패·FK 충돌·사후 수치 불일치는 모두 「확인 화면 이후 범위가 움직였다」는
      // 같은 사실이다. 그 외의 오류는 감추지 않고 그대로 올린다.
      const serializationFailure = isSerializationFailure(error);
      const foreignKeyConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003';
      const deletedScopeMismatch =
        error instanceof TeamDeletedScopeMismatchError;
      if (
        !serializationFailure &&
        !foreignKeyConflict &&
        !deletedScopeMismatch
      ) {
        throw error;
      }
      return {
        outcome: 'scope-changed',
        currentScopeCounts: await this.readScopeCounts(teamId),
      };
    }
  }
}

async function deleteTeamTree(
  tx: Prisma.TransactionClient,
  teamId: string,
): Promise<TeamDeletedCounts> {
  const now = new Date();
  const applicationIds = (
    await tx.application.findMany({
      where: { teamId },
      select: { id: true },
    })
  ).map((application) => application.id);

  // repository-provision 이벤트는 aggregateType='Application'으로 적재된다
  // (applications.repository.ts createRepositoryProvisionEvent).
  if (applicationIds.length > 0) {
    await tx.outboxEvent.deleteMany({
      where: {
        aggregateType: 'Application',
        aggregateId: { in: applicationIds },
      },
    });
  }

  // 판정 알림은 payload에 programName·decision을 그대로 담고 있어 Application을 다시
  // 읽지 않는다 — 남겨 두면 팀이 사라진 뒤에도 학생 화면이 「승인됐습니다」라고 말한다.
  const decisionNotifications =
    applicationIds.length > 0
      ? await tx.notification.findMany({
          where: {
            type: 'APPLICATION_DECISION',
            OR: applicationIds.map((applicationId) => ({
              payload: { path: ['applicationId'], equals: applicationId },
            })),
          },
          select: { id: true },
        })
      : [];
  if (decisionNotifications.length > 0) {
    const decisionNotificationIds = decisionNotifications.map(
      (notification) => notification.id,
    );
    await tx.notification.deleteMany({
      where: {
        type: 'APPLICATION_DECISION_ACKNOWLEDGED',
        idempotencyKey: {
          in: decisionNotificationIds.map(
            (id) => `application-decision-acknowledged:${id}`,
          ),
        },
      },
    });
    await tx.notification.deleteMany({
      where: { id: { in: decisionNotificationIds } },
    });
  }

  // DETACH — 저장소 행은 지우지 않는다. 수집 이력(Contribution·CollectionCommitFact 등)이
  // 그 아래 Cascade로 매달려 있어 행을 지우면 전역 수집 자산이 함께 사라진다.
  // `publishedAt`을 함께 회수하는 이유는 purge와 같다: 공개 아카이브 조회
  // (public-projects.repository.ts)가 「발행된 행이면 program·application 관계가 있다」를
  // 불변식으로 쓰고 non-null 단언까지 하므로, 관계만 끊고 발행 표시를 남기면 500이 난다.
  const githubRepositoriesDetached = await tx.githubRepository.updateMany({
    where: { OR: [{ teamId }, { application: { is: { teamId } } }] },
    data: {
      programId: null,
      applicationId: null,
      teamId: null,
      publishedAt: null,
    },
  });
  await tx.repositoryProvisionJob.deleteMany({
    where: { application: { teamId } },
  });

  // SubmissionFile_deleted_at_check를 지키며 이미 완료된 삭제를 되돌리지 않는다.
  // DELETE_PENDING이 아닌 파일만 cleanup worker에 다시 맡기고 RESTRICT FK를 끊는다.
  const fileScope = {
    OR: [
      { application: { is: { teamId } } },
      { milestoneDocumentSubmission: { is: { application: { teamId } } } },
      {
        submissionHistory: { is: { submission: { application: { teamId } } } },
      },
    ],
  } satisfies Prisma.SubmissionFileWhereInput;
  const detachedFileFks = {
    applicationId: null,
    milestoneId: null,
    milestoneDocumentSubmissionId: null,
    milestoneDocumentSubmissionHistoryId: null,
  } as const;
  const pendingSubmissionFiles = await tx.submissionFile.updateMany({
    where: {
      AND: [fileScope, { lifecycle: { not: SubmissionFileLifecycle.DELETED } }],
    },
    data: {
      ...detachedFileFks,
      lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
      deleteClaimedAt: null,
      deleteClaimExpiresAt: null,
      deleteClaimOwner: null,
      nextDeleteAttemptAt: now,
      lastDeleteError: null,
    },
  });
  const deletedSubmissionFiles = await tx.submissionFile.updateMany({
    where: {
      AND: [fileScope, { lifecycle: SubmissionFileLifecycle.DELETED }],
    },
    data: detachedFileFks,
  });

  const milestoneDocumentReviewHistories =
    await tx.milestoneDocumentReviewHistory.deleteMany({
      where: { milestoneDocumentSubmission: { application: { teamId } } },
    });
  const milestoneDocumentSubmissionHistories =
    await tx.milestoneDocumentSubmissionHistory.deleteMany({
      where: { submission: { application: { teamId } } },
    });
  const milestoneDocumentSubmissions =
    await tx.milestoneDocumentSubmission.deleteMany({
      where: { application: { teamId } },
    });

  const applications = await tx.application.deleteMany({ where: { teamId } });
  const teamInvitations = await tx.teamInvitation.deleteMany({
    where: { teamId },
  });
  const teamMembers = await tx.teamMember.deleteMany({ where: { teamId } });

  return {
    applications: applications.count,
    members: teamMembers.count,
    invitations: teamInvitations.count,
    submissions: milestoneDocumentSubmissions.count,
    submissionEvents:
      pendingSubmissionFiles.count +
      deletedSubmissionFiles.count +
      milestoneDocumentSubmissionHistories.count +
      milestoneDocumentReviewHistories.count,
    detachedRepositories: githubRepositoriesDetached.count,
  };
}
