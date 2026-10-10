import { Injectable } from '@nestjs/common';
import { Prisma, SubmissionFileLifecycle } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../../prisma/audit-log-transaction-writer';
import { isSerializationFailure } from '../../common/prisma-serialization-retry';
import { PrismaService } from '../../prisma/prisma.service';
import {
  readTeamDeletionScopeCounts,
  sameTeamDeletionScopeCountValues,
  sameTeamDeletionScopeCounts,
  type TeamDeletionScopeCounts,
} from '../team-deletion-scope';

export type TeamDeletedCounts = Omit<
  TeamDeletionScopeCounts,
  'scopeFingerprint'
>;

export interface TeamDeletionAuditEvent {
  readonly teamId: string;
  readonly programName: string;
  readonly teamName: string;
  readonly deletedCounts: TeamDeletedCounts;
}

export interface TeamDeletionAuditStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
}

export type RecordTeamDeletionAudit = (
  store: TeamDeletionAuditStore,
  event: TeamDeletionAuditEvent,
) => Promise<void>;

export interface TeamDeletionNotificationStore {
  readonly notificationWriter: Pick<Prisma.TransactionClient, 'notification'>;
}

export interface TeamDeletionNotificationEvent {
  readonly teamId: string;
  readonly teamName: string;
  readonly programId: string;
  readonly programName: string;

  readonly recipientUserIds: readonly string[];
  readonly deletedAt: Date;
}

export type RecordTeamDeletionNotification = (
  store: TeamDeletionNotificationStore,
  event: TeamDeletionNotificationEvent,
) => Promise<void>;

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

@Injectable()
export class ProgramTeamDeletionRepository {
  constructor(private readonly prisma: PrismaService) {}

  readScopeCounts(teamId: string): Promise<TeamDeletionScopeCounts> {
    return this.prisma.$transaction((transaction) =>
      readTeamDeletionScopeCounts(transaction, teamId),
    );
  }

  async deleteTeam(
    programId: string,
    teamId: string,
    expectedScope: TeamDeletionScopeCounts,
    recordAudit: RecordTeamDeletionAudit,
    recordNotification: RecordTeamDeletionNotification,
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

          const recipients = await tx.teamMember.findMany({
            where: { teamId },
            select: { userId: true },
          });
          await recordNotification(
            { notificationWriter: tx },
            {
              teamId,
              teamName: team.name,
              programId,
              programName: team.program.name,
              recipientUserIds: recipients.map((recipient) => recipient.userId),
              deletedAt: new Date(),
            },
          );

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

  if (applicationIds.length > 0) {
    await tx.outboxEvent.deleteMany({
      where: {
        aggregateType: 'Application',
        aggregateId: { in: applicationIds },
      },
    });
  }

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
