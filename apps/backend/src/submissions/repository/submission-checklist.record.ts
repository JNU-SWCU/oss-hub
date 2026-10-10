import {
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  SubmissionFileLifecycle,
} from '@prisma/client';
import type {
  ChecklistMilestone,
  SubmissionFileMetadata,
} from '../domain/submission-record';
import { safeSubmissionFileContentType } from '../domain/submission-file-content-type';
import { publicSubmissionId } from '../domain/submission-public-id';

const SUBMISSION_HISTORY_EVENTS: MilestoneDocumentSubmissionHistoryEvent[] = [
  MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
  MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
];

export const checklistMilestoneOrderBy = [
  { dueAt: 'asc' as const },
  { createdAt: 'asc' as const },
];

export const checklistMilestoneSelect = (applicationId: string, now: Date) =>
  ({
    id: true,
    name: true,
    dueAt: true,
    submissionType: true,
    documents: {
      where: { kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION },
      take: 1,
      select: {
        submissions: {
          where: { applicationId },
          take: 1,
          select: {
            id: true,
            legacySubmissionId: true,
            status: true,
            revision: true,
            reviewHistories: {
              orderBy: { reviewedAt: 'desc' as const },
              take: 1,
              select: {
                decision: true,
                reviewedAt: true,
                comment: true,
              },
            },
            histories: {
              where: {
                event: {
                  in: SUBMISSION_HISTORY_EVENTS,
                },
              },
              orderBy: { revision: 'desc' as const },
              take: 1,
              select: {
                revision: true,
                files: {
                  where: {
                    lifecycle: SubmissionFileLifecycle.ATTACHED,
                    expiresAt: { gt: now },
                  },
                  orderBy: { id: 'asc' as const },
                  take: 1,
                  select: {
                    id: true,
                    originalFileName: true,
                    mimeType: true,
                    sizeBytes: true,
                    expiresAt: true,
                  },
                },
              },
            },
          },
        },
      },
    },
  }) as const;

type ChecklistMilestoneRecord = Prisma.MilestoneGetPayload<{
  select: ReturnType<typeof checklistMilestoneSelect>;
}>;

type ChecklistTargetSubmission = NonNullable<
  ChecklistMilestoneRecord['documents'][number]['submissions'][number]
>;

export function toChecklistMilestone(
  record: ChecklistMilestoneRecord,
): ChecklistMilestone | null {
  if (record.submissionType === null) return null;
  const submission = record.documents[0]?.submissions[0] ?? null;
  return {
    id: record.id,
    name: record.name,
    dueAt: record.dueAt,
    submissionType: record.submissionType,
    submission: submission
      ? {
          id: publicSubmissionId(submission),
          status: submission.status,
          currentRevision: submission.revision,
          latestReview: submission.reviewHistories[0] ?? null,
          file: currentRevisionFile(submission),
        }
      : null,
  };
}

function currentRevisionFile(
  submission: ChecklistTargetSubmission,
): SubmissionFileMetadata | null {
  const currentHistory = submission.histories[0] ?? null;
  if (currentHistory?.revision !== submission.revision) return null;
  const file = currentHistory?.files[0] ?? null;
  if (file === null || file.expiresAt === null) return null;
  return {
    fileId: file.id,
    fileName: file.originalFileName,
    contentType: safeSubmissionFileContentType(file.originalFileName),
    size: file.sizeBytes,
    expiresAt: file.expiresAt,
    downloadUrl: `/api/v1/submission-files/${file.id}`,
  };
}
