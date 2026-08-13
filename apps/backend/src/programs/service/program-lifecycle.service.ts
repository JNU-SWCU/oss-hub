import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  Prisma,
  ProgramAuthoringUploadLifecycle,
  ProgramLifecycle,
  Role,
  SubmissionFileLifecycle,
} from '@prisma/client';
import {
  createProgramDeletionAuditMetadata,
  createProgramLifecycleAuditMetadata,
  PROGRAM_DELETION_AUDIT_ACTIONS,
  PROGRAM_LIFECYCLE_AUDIT_ACTIONS,
  type ProgramDeletionAuditBlockingCounts,
} from '../../audit-log/audit-log-metadata';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DomainException } from '../../common/error-code';
import { isSerializationFailure } from '../../common/prisma-serialization-retry';
import { PrismaService } from '../../prisma/prisma.service';
import {
  readProgramDeletionScopeCounts,
  sameProgramDeletionScopeCounts,
  type ProgramDeletionScopeCounts,
} from '../program-deletion-scope';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from '../program-error-code.enum';

@Injectable()
export class ProgramLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async update(
    githubId: bigint,
    programId: string,
    lifecycle: ProgramLifecycle,
  ) {
    const actor = await this.prisma.user.findUnique({
      where: { githubId },
      select: { role: true, accountStatus: true },
    });
    if (
      actor?.accountStatus !== AccountStatus.ACTIVE ||
      (actor.role !== Role.STAFF && actor.role !== Role.ADMIN)
    ) {
      throw new DomainException(
        PROGRAM_ERROR_CODES[ProgramErrorCode.STAFF_APPROVAL_REQUIRED],
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const program = await transaction.program.findUnique({
        where: { id: programId },
        select: { id: true, name: true, lifecycle: true },
      });
      if (!program) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
        );
      }
      if (program.lifecycle !== lifecycle) {
        await transaction.program.update({
          where: { id: programId },
          data: { lifecycle },
        });
        await this.auditLog.record(
          {
            actorGithubId: githubId,
            action:
              lifecycle === ProgramLifecycle.ARCHIVED
                ? PROGRAM_LIFECYCLE_AUDIT_ACTIONS.PROGRAM_ARCHIVED
                : PROGRAM_LIFECYCLE_AUDIT_ACTIONS.PROGRAM_RESTORED,
            targetType: 'PROGRAM',
            targetId: programId,
            metadata: createProgramLifecycleAuditMetadata({
              programName: program.name,
              before: { lifecycle: program.lifecycle },
              after: { lifecycle },
            }),
          },
          transaction,
        );
      }
      return { id: programId, lifecycle };
    });
  }

  /**
   * ADMIN 전용 영구 삭제. 신청·팀·제출물·게시글 중 하나라도 남아 있으면 409로 막는다 —
   * 학생 데이터가 붙은 프로그램을 지우는 강제 경로는 이 기능의 목적 밖이다(#875).
   * 차단 카운트 확인과 자식 삭제·Program 삭제·감사 로그 기록을 전부 한 트랜잭션 안에서
   * 수행해 확인-삭제 사이의 race를 없앤다.
   */
  async delete(
    githubId: bigint,
    programId: string,
  ): Promise<{ readonly id: string; readonly deleted: true }> {
    const actor = await this.prisma.user.findUnique({
      where: { githubId },
      select: { role: true, accountStatus: true },
    });
    if (
      actor?.accountStatus !== AccountStatus.ACTIVE ||
      actor.role !== Role.ADMIN
    ) {
      throw new DomainException(
        PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN],
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const program = await transaction.program.findUnique({
        where: { id: programId },
        select: {
          id: true,
          name: true,
          lifecycle: true,
          deletionProtected: true,
        },
      });
      if (!program) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
        );
      }
      if (program.deletionProtected) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_PROTECTED],
        );
      }

      const blockingCounts = await this.countDeletionBlockers(
        transaction,
        programId,
      );
      if (
        blockingCounts.applications > 0 ||
        blockingCounts.teams > 0 ||
        blockingCounts.submissions > 0 ||
        blockingCounts.boardPosts > 0
      ) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_BLOCKED],
          { blockingCounts },
        );
      }

      // 불변조건: Application 하드삭제는 SUBMITTED 상태에서만 일어난다
      // (student-application-management.repository.ts의 validateMutation) — 즉 이
      // 지점에서 applications===0이면 GithubRepository(programId — provisioning된 행만
      // 채워진다, #617 단계 D 이후 applicationId 자체는 nullable이지만 provisioning된
      // 행은 항상 applicationId·programId를 함께 갖는다)와 MilestoneDocumentSubmission
      // (applicationId 필수 FK)도 이 programId로는 항상 0이어야 한다.
      // 스키마상 그 두 관계에 onDelete: Cascade가 없어, 이 불변조건이 깨진 채로
      // Program을 지우면 FK 위반 500이 터진다. 도달 불가능해야 하는 경로지만
      // 500을 막기 위해 방어적으로 확인하고, 깨졌다면 새 UI 카테고리를 만드는 대신
      // 이미 있는 409(PRG_012) 차단으로 흡수한다 — blockingCounts는 여전히 전부
      // 0이라 프론트는 이를 일반 차단 안내 문구로 보여준다.
      const [orphanRepositoryCount, orphanMilestoneDocumentSubmissionCount] =
        await Promise.all([
          transaction.githubRepository.count({ where: { programId } }),
          transaction.milestoneDocumentSubmission.count({
            where: { milestoneDocument: { milestone: { programId } } },
          }),
        ]);
      if (
        orphanRepositoryCount > 0 ||
        orphanMilestoneDocumentSubmissionCount > 0
      ) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_BLOCKED],
          { blockingCounts },
        );
      }

      // 교직원이 올린 스캐폴딩(작성 임시 파일·작성 요청)은 학생 데이터가 아니라 명시 삭제한다.
      await this.deleteAuthoringArtifacts(transaction, programId);
      await this.deleteMilestoneTree(transaction, programId);
      await transaction.program.delete({ where: { id: programId } });

      await this.auditLog.record(
        {
          actorGithubId: githubId,
          action: PROGRAM_DELETION_AUDIT_ACTIONS.PROGRAM_DELETED,
          targetType: 'PROGRAM',
          targetId: programId,
          metadata: createProgramDeletionAuditMetadata({
            programName: program.name,
            lifecycle: program.lifecycle,
            blockingCounts,
          }),
        },
        transaction,
      );

      return { id: programId, deleted: true as const };
    });
  }

  /**
   * ADMIN의 의도적 전체 삭제. 기존 `delete`의 409 차단 계약과 독립된 경로다.
   *
   * phase 1은 DB 트랜잭션으로 자식 행을 bottom-up으로 제거하고 파일 FK를 분리해
   * DELETE_PENDING으로 전환한다. phase 2 worker만 storage port를 호출한다.
   *
   * `expectedScope`는 확인 화면(GET edit)이 보여준 4종 자식 범위의 스냅샷이다 —
   * 확인과 purge 사이가 별개 요청이라(#F2 TOCTOU) 확인 이후 생긴 행을 관리자가
   * 보지 못한 채 지울 수 있다. 그래서 삭제 트랜잭션 안에서 GET edit과 동일한
   * 단일 스냅샷 쿼리(`readProgramDeletionScopeCounts`)로 현재 범위를 다시 읽어 비교하고,
   * 다르면 트랜잭션 전체를 abort해 아무것도 지우지 않는다(409 PRG_014, 현재 카운트 포함).
   */
  async purge(
    githubId: bigint,
    programId: string,
    expectedScope: ProgramDeletionScopeCounts,
  ): Promise<ProgramPurgeResult> {
    const actor = await this.prisma.user.findUnique({
      where: { githubId },
      select: { role: true, accountStatus: true },
    });
    if (
      actor?.accountStatus !== AccountStatus.ACTIVE ||
      actor.role !== Role.ADMIN
    ) {
      throw new DomainException(
        PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN],
      );
    }

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const program = await transaction.program.findUnique({
            where: { id: programId },
            select: {
              id: true,
              name: true,
              lifecycle: true,
              deletionProtected: true,
            },
          });
          if (!program) {
            throw new DomainException(
              PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
            );
          }
          if (program.deletionProtected) {
            throw new DomainException(
              PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_PROTECTED],
            );
          }

          // TOCTOU 재확인: 확인 화면이 읽은 이후 생긴 행이 있으면 클라이언트가 보지 못한 채
          // 지워지는 것을 막는다. purgeProgramTree와 같은 트랜잭션 안에서 읽어야
          // 이 비교와 실제 삭제 사이에 또 다른 틀이 생기지 않는다.
          const currentScopeCounts = await readProgramDeletionScopeCounts(
            transaction,
            programId,
          );
          if (
            !sameProgramDeletionScopeCounts(expectedScope, currentScopeCounts)
          ) {
            throw new DomainException(
              PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED],
              { currentScopeCounts },
            );
          }

          const deletedCounts = await this.purgeProgramTree(
            transaction,
            programId,
          );
          if (
            !sameProgramDeletionScopeCounts(currentScopeCounts, {
              applications: deletedCounts.applications,
              teams: deletedCounts.teams,
              boardPosts: deletedCounts.boardPosts,
              submissions: deletedCounts.submissions,
            })
          ) {
            throw new ProgramPurgeDeletedScopeMismatchError();
          }
          await transaction.program.delete({ where: { id: programId } });

          await this.auditLog.record(
            {
              actorGithubId: githubId,
              action: PROGRAM_DELETION_AUDIT_ACTIONS.PROGRAM_DELETED,
              targetType: 'PROGRAM',
              targetId: programId,
              metadata: createProgramDeletionAuditMetadata({
                programName: program.name,
                lifecycle: program.lifecycle,
                blockingCounts: {
                  applications: 0,
                  teams: 0,
                  submissions: 0,
                  boardPosts: 0,
                },
              }),
            },
            transaction,
          );

          return { id: programId, deleted: true as const, deletedCounts };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const serializationFailure = isSerializationFailure(error);
      const foreignKeyConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003';
      const deletedScopeMismatch =
        error instanceof ProgramPurgeDeletedScopeMismatchError;
      if (
        !serializationFailure &&
        !foreignKeyConflict &&
        !deletedScopeMismatch
      ) {
        throw error;
      }

      const currentScopeCounts = await this.prisma.$transaction((transaction) =>
        readProgramDeletionScopeCounts(transaction, programId),
      );
      if (
        serializationFailure ||
        deletedScopeMismatch ||
        !sameProgramDeletionScopeCounts(expectedScope, currentScopeCounts)
      ) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED],
          { currentScopeCounts },
        );
      }
      throw error;
    }
  }

  private async purgeProgramTree(
    transaction: Prisma.TransactionClient,
    programId: string,
  ): Promise<ProgramPurgeDeletedCounts> {
    const now = new Date();
    const fileScope = {
      OR: [
        { application: { is: { programId } } },
        { milestone: { is: { programId } } },
      ],
    } satisfies Prisma.SubmissionFileWhereInput;

    const applicationIds = (
      await transaction.application.findMany({
        where: { programId },
        select: { id: true },
      })
    ).map((application) => application.id);

    const publicShowcaseRepositories =
      await transaction.publicShowcaseRepository.deleteMany({
        where: { programId },
      });
    const programOutboxEvents = await transaction.outboxEvent.deleteMany({
      where: { aggregateType: 'PROGRAM', aggregateId: programId },
    });
    // repository-provision 이벤트는 aggregateType='Application'/aggregateId=applicationId로
    // 적재된다(applications.repository.ts createRepositoryProvisionEvent) — Program
    // aggregateId로는 잡히지 않으므로 이 프로그램 산하 Application id로 별도 조회한다.
    const applicationOutboxEvents =
      applicationIds.length > 0
        ? await transaction.outboxEvent.deleteMany({
            where: {
              aggregateType: 'Application',
              aggregateId: { in: applicationIds },
            },
          })
        : { count: 0 };
    const outboxEvents = {
      count: programOutboxEvents.count + applicationOutboxEvents.count,
    };

    // 프로그램에 붙은 Notification: APPLICATION_DECISION(payload.programId)과
    // 그 응답 확인 기록(APPLICATION_DECISION_ACKNOWLEDGED, notificationId로 원본을 참조),
    // DEADLINE_DIGEST(idempotencyKey에 programId가 박혀 있고 payload에는 없다 —
    // deadline-digest.service.ts sendStaffRecipient/sendRecipient 참조).
    const applicationDecisionNotifications =
      await transaction.notification.findMany({
        where: {
          type: 'APPLICATION_DECISION',
          payload: { path: ['programId'], equals: programId },
        },
        select: { id: true },
      });
    const applicationDecisionNotificationIds =
      applicationDecisionNotifications.map((notification) => notification.id);
    const applicationDecisionAcknowledgedNotifications =
      applicationDecisionNotificationIds.length > 0
        ? await transaction.notification.deleteMany({
            where: {
              type: 'APPLICATION_DECISION_ACKNOWLEDGED',
              idempotencyKey: {
                in: applicationDecisionNotificationIds.map(
                  (id) => `application-decision-acknowledged:${id}`,
                ),
              },
            },
          })
        : { count: 0 };
    const applicationDecisionNotificationsDeleted =
      applicationDecisionNotificationIds.length > 0
        ? await transaction.notification.deleteMany({
            where: { id: { in: applicationDecisionNotificationIds } },
          })
        : { count: 0 };
    const deadlineDigestNotifications =
      await transaction.notification.deleteMany({
        where: {
          type: 'DEADLINE_DIGEST',
          idempotencyKey: { contains: `:${programId}:` },
        },
      });
    const notifications = {
      count:
        applicationDecisionNotificationsDeleted.count +
        applicationDecisionAcknowledgedNotifications.count +
        deadlineDigestNotifications.count,
    };

    const boardComments = await transaction.boardComment.deleteMany({
      where: { post: { programId } },
    });
    const boardPosts = await transaction.boardPost.deleteMany({
      where: { programId },
    });

    // EXTERNAL_PUBLIC과 ORG_PROVISIONED 모두 전역 수집 자산으로 보존한다.
    // publicProjects.repository.ts(공개 아카이브)는 publishedAt이 설정된 행이면 항상
    // program/application 관계가 존재한다고 가정한다(provisioning이 만든 행만 발행되므로).
    // detach로 그 관계를 끊으면서 publishedAt을 그대로 두면 이 불변식이 깨져 공개
    // 아카이브 조회가 program/application이 사라진 행에서 500을 낸다 — 그래서 detach와
    // 함께 publishedAt도 revoke한다(공개 아카이브 노출 자격은 program 존재에 종속).
    const githubRepositoriesDetached =
      await transaction.githubRepository.updateMany({
        where: {
          OR: [
            { programId },
            { application: { is: { programId } } },
            { team: { is: { programId } } },
          ],
        },
        data: {
          programId: null,
          applicationId: null,
          teamId: null,
          publishedAt: null,
        },
      });
    const repositoryProvisionJobs =
      await transaction.repositoryProvisionJob.deleteMany({
        where: { application: { programId } },
      });

    // SubmissionFile은 nullable RESTRICT FK를 끊고 기존 cleanup worker에 맡긴다.
    const submissionFiles = await transaction.submissionFile.updateMany({
      where: fileScope,
      data: {
        lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
        applicationId: null,
        milestoneId: null,
        submissionRevisionId: null,
        milestoneDocumentSubmissionId: null,
        deleteClaimedAt: null,
        deleteClaimExpiresAt: null,
        deleteClaimOwner: null,
        nextDeleteAttemptAt: now,
        lastDeleteError: null,
      },
    });

    const createRequest = await transaction.programCreateRequest.findUnique({
      where: { programId },
      select: { id: true, actorId: true },
    });
    const programAuthoringUploads = createRequest
      ? await transaction.programAuthoringUpload.updateMany({
          where: {
            createRequestId: createRequest.id,
            createRequestActorId: createRequest.actorId,
          },
          data: {
            lifecycle: ProgramAuthoringUploadLifecycle.DELETE_PENDING,
            attachedAt: null,
            createRequestId: null,
            createRequestActorId: null,
            deleteClaimedAt: null,
            deleteClaimExpiresAt: null,
            deleteClaimOwner: null,
            nextDeleteAttemptAt: now,
            lastDeleteError: null,
          },
        })
      : { count: 0 };

    const templateFiles =
      await transaction.milestoneDocumentTemplateFile.findMany({
        where: { milestoneDocument: { milestone: { programId } } },
        select: { storageKey: true },
      });
    if (templateFiles.length > 0) {
      await transaction.programPurgeFileTombstone.createMany({
        data: templateFiles.map((file) => ({
          storageKey: file.storageKey,
          nextDeleteAttemptAt: now,
        })),
        skipDuplicates: true,
      });
    }

    const reviews = await transaction.review.deleteMany({
      where: {
        submissionRevision: { submission: { milestone: { programId } } },
      },
    });
    const submissionRevisions = await transaction.submissionRevision.deleteMany(
      {
        where: { submission: { milestone: { programId } } },
      },
    );
    const submissions = await transaction.submission.deleteMany({
      where: { milestone: { programId } },
    });

    const milestoneDocumentReviewHistories =
      await transaction.milestoneDocumentReviewHistory.deleteMany({
        where: {
          milestoneDocumentSubmission: {
            milestoneDocument: { milestone: { programId } },
          },
        },
      });
    const milestoneDocumentSubmissions =
      await transaction.milestoneDocumentSubmission.deleteMany({
        where: { milestoneDocument: { milestone: { programId } } },
      });
    const milestoneDocumentTemplateFiles =
      await transaction.milestoneDocumentTemplateFile.deleteMany({
        where: { milestoneDocument: { milestone: { programId } } },
      });
    const milestoneDocuments = await transaction.milestoneDocument.deleteMany({
      where: { milestone: { programId } },
    });

    const applications = await transaction.application.deleteMany({
      where: { programId },
    });
    const teamInvitations = await transaction.teamInvitation.deleteMany({
      where: { programId },
    });
    const teamMembers = await transaction.teamMember.deleteMany({
      where: { programId },
    });
    const teams = await transaction.team.deleteMany({ where: { programId } });
    const programCreateRequests = createRequest
      ? await transaction.programCreateRequest.deleteMany({
          where: { programId },
        })
      : { count: 0 };
    const milestones = await transaction.milestone.deleteMany({
      where: { programId },
    });

    return {
      applications: applications.count,
      teams: teams.count,
      teamMembers: teamMembers.count,
      teamInvitations: teamInvitations.count,
      boardPosts: boardPosts.count,
      boardComments: boardComments.count,
      submissions: submissions.count,
      submissionRevisions: submissionRevisions.count,
      reviews: reviews.count,
      submissionFiles: submissionFiles.count,
      milestones: milestones.count,
      milestoneDocuments: milestoneDocuments.count,
      milestoneDocumentSubmissions: milestoneDocumentSubmissions.count,
      milestoneDocumentReviewHistories: milestoneDocumentReviewHistories.count,
      milestoneDocumentTemplateFiles: milestoneDocumentTemplateFiles.count,
      programAuthoringUploads: programAuthoringUploads.count,
      programCreateRequests: programCreateRequests.count,
      repositoryProvisionJobs: repositoryProvisionJobs.count,
      githubRepositoriesDetached: githubRepositoriesDetached.count,
      publicShowcaseRepositories: publicShowcaseRepositories.count,
      outboxEvents: outboxEvents.count,
      notifications: notifications.count,
      programPurgeFileTombstones: templateFiles.length,
    };
  }

  private async countDeletionBlockers(
    transaction: Prisma.TransactionClient,
    programId: string,
  ): Promise<ProgramDeletionAuditBlockingCounts> {
    const [applications, teams, boardPosts, submissions] = await Promise.all([
      transaction.application.count({ where: { programId } }),
      transaction.team.count({ where: { programId } }),
      transaction.boardPost.count({ where: { programId } }),
      transaction.submission.count({ where: { milestone: { programId } } }),
    ]);
    return { applications, teams, boardPosts, submissions };
  }

  /** ProgramCreateRequest(actor별 idempotency 기록)와 그에 딸린 임시 업로드를 지운다. */
  private async deleteAuthoringArtifacts(
    transaction: Prisma.TransactionClient,
    programId: string,
  ): Promise<void> {
    const createRequest = await transaction.programCreateRequest.findUnique({
      where: { programId },
      select: { id: true, actorId: true },
    });
    if (!createRequest) return;
    await transaction.programAuthoringUpload.deleteMany({
      where: {
        createRequestId: createRequest.id,
        createRequestActorId: createRequest.actorId,
      },
    });
    await transaction.programCreateRequest.delete({ where: { programId } });
  }

  /**
   * Milestone → MilestoneDocument → MilestoneDocumentTemplateFile 순으로 지운다.
   * SubmissionFile은 applicationId=0(차단 통과 시점)이어도 milestoneId만 채운 채 첨부 전
   * 대기 상태로 남은 고아 업로드가 있을 수 있어, Milestone 삭제 전에 명시적으로 함께 치운다.
   */
  private async deleteMilestoneTree(
    transaction: Prisma.TransactionClient,
    programId: string,
  ): Promise<void> {
    const milestones = await transaction.milestone.findMany({
      where: { programId },
      select: { id: true },
    });
    const milestoneIds = milestones.map((milestone) => milestone.id);
    if (milestoneIds.length === 0) return;

    const documents = await transaction.milestoneDocument.findMany({
      where: { milestoneId: { in: milestoneIds } },
      select: { id: true },
    });
    const documentIds = documents.map((document) => document.id);
    if (documentIds.length > 0) {
      await transaction.milestoneDocumentTemplateFile.deleteMany({
        where: { milestoneDocumentId: { in: documentIds } },
      });
    }

    await transaction.submissionFile.deleteMany({
      where: { milestoneId: { in: milestoneIds } },
    });
    await transaction.milestoneDocument.deleteMany({
      where: { milestoneId: { in: milestoneIds } },
    });
    await transaction.milestone.deleteMany({ where: { programId } });
  }
}

class ProgramPurgeDeletedScopeMismatchError extends Error {
  constructor() {
    super('Program purge deleted counts differ from its confirmed scope.');
    this.name = 'ProgramPurgeDeletedScopeMismatchError';
  }
}

export type ProgramPurgeDeletedCounts = {
  readonly applications: number;
  readonly teams: number;
  readonly teamMembers: number;
  readonly teamInvitations: number;
  readonly boardPosts: number;
  readonly boardComments: number;
  readonly submissions: number;
  readonly submissionRevisions: number;
  readonly reviews: number;
  readonly submissionFiles: number;
  readonly milestones: number;
  readonly milestoneDocuments: number;
  readonly milestoneDocumentSubmissions: number;
  readonly milestoneDocumentReviewHistories: number;
  readonly milestoneDocumentTemplateFiles: number;
  readonly programAuthoringUploads: number;
  readonly programCreateRequests: number;
  readonly repositoryProvisionJobs: number;
  readonly githubRepositoriesDetached: number;
  readonly publicShowcaseRepositories: number;
  readonly outboxEvents: number;
  readonly notifications: number;
  readonly programPurgeFileTombstones: number;
};

export type ProgramPurgeResult = {
  readonly id: string;
  readonly deleted: true;
  readonly deletedCounts: ProgramPurgeDeletedCounts;
};
