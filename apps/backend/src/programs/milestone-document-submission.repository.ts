import {
  MilestoneDocumentSubmissionHistoryEvent,
  MilestoneSubmissionType,
  Prisma,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';
import { SubmissionMembershipChangedError } from './submission-membership-changed.error';
import { type MilestoneDocumentSubmissionDetail } from './milestone-document-collection-read.repository';
import { nextMilestoneDocumentHistoryCreatedAt } from './milestone-document-history.config';
import {
  MilestoneDocumentPendingFileMissingError,
  MilestoneDocumentReviewChangedError,
  MilestoneDocumentDeadlineClosedError,
  MilestoneDocumentSubmissionChangedError,
  MilestoneDocumentMissingError,
} from './milestone-document-submission.error';

export class MilestoneDocumentSubmissionRepository {
  static milestoneDocumentSubmissionContent(
    text: string | null,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return text === null
      ? Prisma.JsonNull
      : { type: MilestoneSubmissionType.TEXT, text };
  }

  static upsertMilestoneDocumentSubmission(
    prisma: PrismaService,
    input: UpsertMilestoneDocumentSubmissionInput,
  ): Promise<MilestoneDocumentSubmissionDetail> {
    return prisma.$transaction(async (transaction) => {
      const stillMember = await PlatformRepository.lockSubmissionMembership(
        transaction,
        input.applicationId,
        input.submittedById,
      );
      if (!stillMember) {
        throw new SubmissionMembershipChangedError(
          input.applicationId,
          input.submittedById,
        );
      }

      let afterDeadline = false;
      if (input.deadline !== undefined) {
        const milestone = await transaction.$queryRaw<
          readonly { dueAt: Date }[]
        >(
          Prisma.sql`
          SELECT "dueAt"
          FROM "Milestone"
          WHERE "id" = ${input.deadline.milestoneId}
          FOR SHARE
        `,
        );
        const dueAt = milestone[0]?.dueAt;
        afterDeadline =
          dueAt !== undefined && input.submittedAt.getTime() > dueAt.getTime();
      }
      const documents = await transaction.$queryRaw<
        readonly { id: string; graceDueAt: Date | null }[]
      >(
        Prisma.sql`
      SELECT "id", "graceDueAt"
      FROM "MilestoneDocument"
      WHERE "id" = ${input.milestoneDocumentId}
      FOR UPDATE
    `,
      );
      const document = documents[0];
      if (document === undefined) throw new MilestoneDocumentMissingError();
      if (
        afterDeadline &&
        input.deadline !== undefined &&
        !input.deadline.allowAfterDeadline &&
        !(
          input.expectedLatestReviewId === null &&
          document.graceDueAt != null &&
          input.submittedAt.getTime() <= document.graceDueAt.getTime()
        )
      ) {
        throw new MilestoneDocumentDeadlineClosedError();
      }
      const latestHistory =
        await transaction.milestoneDocumentSubmissionHistory.findFirst({
          where: {
            submission: {
              milestoneDocumentId: input.milestoneDocumentId,
              applicationId: input.applicationId,
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { createdAt: true },
        });
      const submittedAt = nextMilestoneDocumentHistoryCreatedAt(
        input.submittedAt,
        latestHistory?.createdAt ?? null,
      );

      const latestReview =
        await transaction.milestoneDocumentReviewHistory.findFirst({
          where: {
            milestoneDocumentSubmission: {
              milestoneDocumentId: input.milestoneDocumentId,
              applicationId: input.applicationId,
            },
          },
          orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
      if ((latestReview?.id ?? null) !== input.expectedLatestReviewId) {
        throw new MilestoneDocumentReviewChangedError();
      }

      if (afterDeadline && input.deadline !== undefined) {
        const current =
          await transaction.milestoneDocumentSubmission.findUnique({
            where: {
              milestoneDocumentId_applicationId: {
                milestoneDocumentId: input.milestoneDocumentId,
                applicationId: input.applicationId,
              },
            },
            select: { status: true },
          });
        if (
          (current?.status ?? null) !== input.deadline.expectedSubmissionStatus
        )
          throw new MilestoneDocumentSubmissionChangedError();
      }

      const submission = await transaction.milestoneDocumentSubmission.upsert({
        where: {
          milestoneDocumentId_applicationId: {
            milestoneDocumentId: input.milestoneDocumentId,
            applicationId: input.applicationId,
          },
        },
        update: {
          status: SubmissionStatus.SUBMITTED,
          content: input.content,
          submittedById: input.submittedById,
          submittedAt,
          revision: { increment: 1 },
        },
        create: {
          milestoneDocumentId: input.milestoneDocumentId,
          applicationId: input.applicationId,
          status: SubmissionStatus.SUBMITTED,
          content: input.content,
          submittedById: input.submittedById,
          submittedAt,
        },
        select: {
          id: true,
          status: true,
          content: true,
          submittedAt: true,
          revision: true,
        },
      });

      const history =
        await transaction.milestoneDocumentSubmissionHistory.create({
          data: {
            milestoneDocumentSubmissionId: submission.id,
            event:
              submission.revision === 1
                ? MilestoneDocumentSubmissionHistoryEvent.SUBMITTED
                : MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
            revision: submission.revision,
            actorId: input.submittedById,
            content: input.content,
            createdAt: submittedAt,
          },
          select: { id: true },
        });

      if (input.attachFile !== null) {
        const attached = await transaction.submissionFile.updateMany({
          where: {
            id: input.attachFile.fileId,
            uploaderId: input.attachFile.uploaderId,
            applicationId: input.applicationId,
            milestoneId: input.attachFile.milestoneId,
            lifecycle: SubmissionFileLifecycle.PENDING,
            pendingExpiresAt: { gt: input.submittedAt },
          },
          data: {
            milestoneDocumentSubmissionId: submission.id,
            milestoneDocumentSubmissionHistoryId: history.id,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            pendingExpiresAt: null,
          },
        });
        if (attached.count !== 1) {
          throw new MilestoneDocumentPendingFileMissingError();
        }
      }

      const files = await transaction.submissionFile.findMany({
        where: {
          milestoneDocumentSubmissionHistoryId: history.id,
          lifecycle: SubmissionFileLifecycle.ATTACHED,
        },
        orderBy: { createdAt: 'desc' },
        select: attachedFileSelect,
      });

      return {
        id: submission.id,
        status: submission.status,
        content: submission.content,
        submittedAt: submission.submittedAt,
        files,
      };
    });
  }
}

export interface UpsertMilestoneDocumentSubmissionInput {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
  readonly submittedById: string;
  readonly submittedAt: Date;
  readonly deadline?: {
    readonly milestoneId: string;
    readonly allowAfterDeadline: boolean;
    readonly expectedSubmissionStatus: SubmissionStatus | null;
  };
  readonly expectedLatestReviewId: string | null;
  readonly content: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  readonly attachFile: {
    readonly fileId: string;
    readonly uploaderId: string;
    readonly milestoneId: string;
  } | null;
}

const attachedFileSelect = {
  id: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
} as const;
