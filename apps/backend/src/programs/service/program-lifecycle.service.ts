import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  Prisma,
  ProgramAuthoringUploadLifecycle,
  SubmissionFileLifecycle,
} from '@prisma/client';
import {
  createProgramDeletionAuditMetadata,
  PROGRAM_DELETION_AUDIT_ACTIONS,
  type ProgramDeletionAuditBlockingCounts,
} from '../../audit-log/domain/audit-log-metadata';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { DomainException } from '../../common/error-code';
import { isSerializationFailure } from '../../common/repository/prisma-serialization-retry';
import { PrismaService } from '../../prisma/prisma.service';
import {
  readProgramDeletionScopeCounts,
  sameProgramDeletionScopeCountValues,
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

  async delete(
    githubId: bigint,
    programId: string,
  ): Promise<{ readonly id: string; readonly deleted: true }> {
    const actor = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
    if (
      actor?.accountStatus !== AccountStatus.ACTIVE ||
      (!actor.hasStaffAccess && !actor.hasAdminAccess)
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
        },
      });
      if (!program) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
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

      const orphanRepositoryCount = await transaction.githubRepository.count({
        where: { programId },
      });
      if (orphanRepositoryCount > 0) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_BLOCKED],
          { blockingCounts },
        );
      }

      await this.deleteAuthoringArtifacts(transaction, programId);
      await this.deleteMilestoneTree(transaction, programId);
      await this.deleteProgramCover(transaction, programId);
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

  async purge(
    githubId: bigint,
    programId: string,
    expectedScope: ProgramDeletionScopeCounts,
  ): Promise<ProgramPurgeResult> {
    const actor = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
    if (
      actor?.accountStatus !== AccountStatus.ACTIVE ||
      (!actor.hasStaffAccess && !actor.hasAdminAccess)
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
            },
          });
          if (!program) {
            throw new DomainException(
              PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
            );
          }

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
            !sameProgramDeletionScopeCountValues(currentScopeCounts, {
              applications: deletedCounts.applications,
              teams: deletedCounts.teams,
              boardPosts: deletedCounts.boardPosts,
              submissions: deletedCounts.submissions,
              submissionEvents:
                deletedCounts.submissionFiles +
                deletedCounts.milestoneDocumentSubmissionHistories +
                deletedCounts.milestoneDocumentReviewHistories,
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
        {
          submissionHistory: {
            is: {
              submission: {
                milestoneDocument: { milestone: { programId } },
              },
            },
          },
        },
      ],
    } satisfies Prisma.SubmissionFileWhereInput;

    const applicationIds = (
      await transaction.application.findMany({
        where: { programId },
        select: { id: true },
      })
    ).map((application) => application.id);

    const programOutboxEvents = await transaction.outboxEvent.deleteMany({
      where: { aggregateType: 'PROGRAM', aggregateId: programId },
    });

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

    const teamDeletedNotifications = await transaction.notification.deleteMany({
      where: {
        type: 'TEAM_DELETED',
        payload: { path: ['programId'], equals: programId },
      },
    });
    const notifications = {
      count:
        applicationDecisionNotificationsDeleted.count +
        applicationDecisionAcknowledgedNotifications.count +
        deadlineDigestNotifications.count +
        teamDeletedNotifications.count,
    };

    const boardComments = await transaction.boardComment.deleteMany({
      where: { post: { programId } },
    });
    const boardPosts = await transaction.boardPost.deleteMany({
      where: { programId },
    });

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

    const pendingSubmissionFiles = await transaction.submissionFile.updateMany({
      where: {
        AND: [
          fileScope,
          { lifecycle: { not: SubmissionFileLifecycle.DELETED } },
        ],
      },
      data: {
        lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
        applicationId: null,
        milestoneId: null,
        milestoneDocumentSubmissionId: null,
        milestoneDocumentSubmissionHistoryId: null,
        deleteClaimedAt: null,
        deleteClaimExpiresAt: null,
        deleteClaimOwner: null,
        nextDeleteAttemptAt: now,
        lastDeleteError: null,
      },
    });
    const deletedSubmissionFiles = await transaction.submissionFile.updateMany({
      where: {
        AND: [fileScope, { lifecycle: SubmissionFileLifecycle.DELETED }],
      },
      data: {
        applicationId: null,
        milestoneId: null,
        milestoneDocumentSubmissionId: null,
        milestoneDocumentSubmissionHistoryId: null,
      },
    });
    const submissionFiles = {
      count: pendingSubmissionFiles.count + deletedSubmissionFiles.count,
    };

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

    const milestoneDocumentReviewHistories =
      await transaction.milestoneDocumentReviewHistory.deleteMany({
        where: {
          milestoneDocumentSubmission: {
            milestoneDocument: { milestone: { programId } },
          },
        },
      });
    const milestoneDocumentSubmissionHistories =
      await transaction.milestoneDocumentSubmissionHistory.deleteMany({
        where: {
          submission: {
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
    const programCovers = await this.deleteProgramCover(transaction, programId);

    return {
      applications: applications.count,
      teams: teams.count,
      teamMembers: teamMembers.count,
      teamInvitations: teamInvitations.count,
      boardPosts: boardPosts.count,
      boardComments: boardComments.count,
      submissions: milestoneDocumentSubmissions.count,
      submissionRevisions: 0,
      reviews: 0,
      submissionFiles: submissionFiles.count,
      milestones: milestones.count,
      milestoneDocuments: milestoneDocuments.count,
      milestoneDocumentSubmissions: milestoneDocumentSubmissions.count,
      milestoneDocumentSubmissionHistories:
        milestoneDocumentSubmissionHistories.count,
      milestoneDocumentReviewHistories: milestoneDocumentReviewHistories.count,
      milestoneDocumentTemplateFiles: milestoneDocumentTemplateFiles.count,
      programAuthoringUploads: programAuthoringUploads.count,
      programCreateRequests: programCreateRequests.count,
      repositoryProvisionJobs: repositoryProvisionJobs.count,
      githubRepositoriesDetached: githubRepositoriesDetached.count,
      outboxEvents: outboxEvents.count,
      notifications: notifications.count,
      programPurgeFileTombstones: templateFiles.length + programCovers,
    };
  }

  private async deleteProgramCover(
    transaction: Prisma.TransactionClient,
    programId: string,
  ): Promise<number> {
    const cover = await transaction.programCover.findUnique({
      where: { programId },
      select: { storageKey: true },
    });
    if (!cover) return 0;
    if (cover.storageKey !== null) {
      await transaction.programPurgeFileTombstone.createMany({
        data: [
          { storageKey: cover.storageKey, nextDeleteAttemptAt: new Date() },
        ],
        skipDuplicates: true,
      });
    }
    await transaction.programCover.delete({
      where: { programId },
    });
    return cover.storageKey === null ? 0 : 1;
  }

  private async countDeletionBlockers(
    transaction: Prisma.TransactionClient,
    programId: string,
  ): Promise<ProgramDeletionAuditBlockingCounts> {
    const [applications, teams, boardPosts, submissions] = await Promise.all([
      transaction.application.count({ where: { programId } }),
      transaction.team.count({ where: { programId } }),
      transaction.boardPost.count({ where: { programId } }),
      transaction.milestoneDocumentSubmission.count({
        where: { milestoneDocument: { milestone: { programId } } },
      }),
    ]);
    return { applications, teams, boardPosts, submissions };
  }

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
  readonly milestoneDocumentSubmissionHistories: number;
  readonly milestoneDocumentReviewHistories: number;
  readonly milestoneDocumentTemplateFiles: number;
  readonly programAuthoringUploads: number;
  readonly programCreateRequests: number;
  readonly repositoryProvisionJobs: number;
  readonly githubRepositoriesDetached: number;
  readonly outboxEvents: number;
  readonly notifications: number;
  readonly programPurgeFileTombstones: number;
};

export type ProgramPurgeResult = {
  readonly id: string;
  readonly deleted: true;
  readonly deletedCounts: ProgramPurgeDeletedCounts;
};
