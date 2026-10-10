import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ProgramAuthoringUploadLifecycle,
  SubmissionFileLifecycle,
} from '@prisma/client';
import type { ProgramDeletionAuditBlockingCounts } from '../../audit-log/domain/audit-log-metadata';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProgramDeletionScopeCounts } from '../domain/program-deletion-scope';
import type { ProgramPurgeDeletedCounts } from '../domain/program-purge';
import { readProgramDeletionScopeCounts } from './program-deletion-scope';

type ProgramLifecycleTransaction = Prisma.TransactionClient;

export function isForeignKeyConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  );
}

@Injectable()
export class ProgramLifecycleRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDeletionActor(githubId: bigint) {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: {
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
  }

  withDeleteTransaction<T>(
    operation: (transaction: ProgramLifecycleTransaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(operation);
  }

  withPurgeTransaction<T>(
    operation: (transaction: ProgramLifecycleTransaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  readScopeCounts(programId: string): Promise<ProgramDeletionScopeCounts> {
    return this.prisma.$transaction((transaction) =>
      readProgramDeletionScopeCounts(transaction, programId),
    );
  }

  readScopeCountsInTransaction(
    transaction: ProgramLifecycleTransaction,
    programId: string,
  ): Promise<ProgramDeletionScopeCounts> {
    return readProgramDeletionScopeCounts(transaction, programId);
  }

  findProgramForDeletion(
    transaction: ProgramLifecycleTransaction,
    programId: string,
  ) {
    return transaction.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
        name: true,
        lifecycle: true,
      },
    });
  }

  async countDeletionBlockers(
    transaction: ProgramLifecycleTransaction,
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

  countOrphanRepositories(
    transaction: ProgramLifecycleTransaction,
    programId: string,
  ): Promise<number> {
    return transaction.githubRepository.count({ where: { programId } });
  }

  async deleteAuthoringArtifacts(
    transaction: ProgramLifecycleTransaction,
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

  async deleteMilestoneTree(
    transaction: ProgramLifecycleTransaction,
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

  async deleteProgramCover(
    transaction: ProgramLifecycleTransaction,
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

  async deleteProgram(
    transaction: ProgramLifecycleTransaction,
    programId: string,
  ): Promise<void> {
    await transaction.program.delete({ where: { id: programId } });
  }

  async purgeProgramTree(
    transaction: ProgramLifecycleTransaction,
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
}
