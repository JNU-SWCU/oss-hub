import {
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  MilestoneDocumentSubmissionDetail,
  UpsertMilestoneDocumentSubmissionInput,
} from './milestone-documents.repository';
import { nextMilestoneDocumentHistoryCreatedAt } from './milestone-document-history';

export class MilestoneDocumentPendingFileMissingError extends Error {
  override readonly name = 'MilestoneDocumentPendingFileMissingError';
}

export class MilestoneDocumentReviewChangedError extends Error {
  override readonly name = 'MilestoneDocumentReviewChangedError';
}

export class MilestoneDocumentDeadlineClosedError extends Error {
  override readonly name = 'MilestoneDocumentDeadlineClosedError';
}

export class MilestoneDocumentMissingError extends Error {
  override readonly name = 'MilestoneDocumentMissingError';
}

const attachedFileSelect = {
  id: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
} as const;

/**
 * 학생 제출의 잠금·기대 버전 확인·append-only 이력 쓰기를 한 경계에 모은다. 이전 첨부는
 * 삭제하지 않고 자기 제출 이력에 연결된 채 보존하며, 현재 파일 판정은 최신 이력의 revision으로
 * 한다. 이 함수 밖의 목록/CRUD repository가 이 동시성 규칙을 다시 구현하지 않는다.
 */
export function upsertMilestoneDocumentSubmission(
  prisma: PrismaService,
  input: UpsertMilestoneDocumentSubmissionInput,
): Promise<MilestoneDocumentSubmissionDetail> {
  return prisma.$transaction(async (transaction) => {
    if (input.deadline !== undefined) {
      const milestone = await transaction.$queryRaw<readonly { dueAt: Date }[]>(
        Prisma.sql`
          SELECT "dueAt"
          FROM "Milestone"
          WHERE "id" = ${input.deadline.milestoneId}
          FOR SHARE
        `,
      );
      const dueAt = milestone[0]?.dueAt;
      if (
        dueAt !== undefined &&
        !input.deadline.allowAfterDeadline &&
        input.submittedAt.getTime() > dueAt.getTime()
      ) {
        throw new MilestoneDocumentDeadlineClosedError();
      }
    }
    const documents = await transaction.$queryRaw<readonly { id: string }[]>(
      Prisma.sql`
      SELECT "id"
      FROM "MilestoneDocument"
      WHERE "id" = ${input.milestoneDocumentId}
      FOR UPDATE
    `,
    );
    if (documents.length === 0) throw new MilestoneDocumentMissingError();
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

    const history = await transaction.milestoneDocumentSubmissionHistory.create(
      {
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
      },
    );

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
