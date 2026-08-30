import {
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  SubmissionFileLifecycle,
} from '@prisma/client';
import { safeSubmissionFileContentType } from './submission-file-content-type';
import type {
  ChecklistLatestReview,
  ChecklistMilestone,
  SubmissionFileMetadata,
} from './submissions.repository';

/** #103 프로그램 상세와 동일한 마일스톤 정렬 계약 — dueAt ASC, 동률은 createdAt ASC. */
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
              select: {
                revision: true,
                files: {
                  where: {
                    lifecycle: SubmissionFileLifecycle.ATTACHED,
                    expiresAt: { gt: now },
                  },
                  orderBy: { id: 'asc' as const },
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
          id: submission.legacySubmissionId ?? submission.id,
          status: submission.status,
          currentRevision: submission.revision,
          latestReview: latestReview(submission),
          file: currentRevisionFile(submission),
        }
      : null,
  };
}

function latestReview(
  submission: ChecklistTargetSubmission,
): ChecklistLatestReview | null {
  return submission.reviewHistories[0] ?? null;
}

function currentRevisionFile(
  submission: ChecklistTargetSubmission,
): SubmissionFileMetadata | null {
  const currentHistory = submission.histories.find(
    (history) => history.revision === submission.revision,
  );
  const file = currentHistory?.files[0] ?? null;
  if (file === null || file.expiresAt === null) return null;
  return {
    fileId: file.id,
    fileName: file.originalFileName,
    contentType: safeSubmissionFileContentType(
      file.originalFileName,
      file.mimeType,
    ),
    size: file.sizeBytes,
    expiresAt: file.expiresAt,
    downloadUrl: `/api/v1/submission-files/${file.id}`,
  };
}
