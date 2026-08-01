import { Prisma, SubmissionFileLifecycle } from '@prisma/client';
import { safeSubmissionFileContentType } from './submission-file-content-type';
import type {
  ChecklistLatestReview,
  ChecklistMilestone,
  SubmissionFileMetadata,
} from './submissions.repository';

/** #103 프로그램 상세와 동일한 마일스톤 정렬 계약 — dueAt ASC, 동률은 createdAt ASC. */
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
    submissions: {
      where: { applicationId },
      take: 1,
      select: {
        id: true,
        status: true,
        currentRevision: true,
        revisions: {
          orderBy: { revision: 'desc' as const },
          select: {
            revision: true,
            review: { select: { reviewedAt: true, comment: true } },
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
  }) as const;

type ChecklistMilestoneRecord = Prisma.MilestoneGetPayload<{
  select: ReturnType<typeof checklistMilestoneSelect>;
}>;

export function toChecklistMilestone(
  record: ChecklistMilestoneRecord,
): ChecklistMilestone {
  const submission = record.submissions[0] ?? null;
  return {
    id: record.id,
    name: record.name,
    dueAt: record.dueAt,
    submissionType: record.submissionType,
    submission: submission
      ? {
          id: submission.id,
          status: submission.status,
          currentRevision: submission.currentRevision,
          latestReview: latestReview(submission.revisions),
          file: currentRevisionFile(submission),
        }
      : null,
  };
}

/** 최신 Review = review가 달린 가장 높은 revision의 Review (revision당 Review는 최대 1건). */
function latestReview(
  revisions: ChecklistMilestoneRecord['submissions'][number]['revisions'],
): ChecklistLatestReview | null {
  for (const revision of revisions) {
    if (revision.review) return revision.review;
  }
  return null;
}

function currentRevisionFile(
  submission: NonNullable<ChecklistMilestoneRecord['submissions'][number]>,
): SubmissionFileMetadata | null {
  const currentRevision = submission.revisions.find(
    (revision) => revision.revision === submission.currentRevision,
  );
  const file = currentRevision?.files[0] ?? null;
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
