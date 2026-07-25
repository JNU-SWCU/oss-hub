import { Prisma } from '@prisma/client';
import type {
  ChecklistLatestReview,
  ChecklistMilestone,
} from './submissions.repository';

/** #103 프로그램 상세와 동일한 마일스톤 정렬 계약 — dueAt ASC, 동률은 createdAt ASC. */
export const checklistMilestoneOrderBy = [
  { dueAt: 'asc' as const },
  { createdAt: 'asc' as const },
];

export const checklistMilestoneSelect = (applicationId: string) =>
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
            review: { select: { reviewedAt: true, comment: true } },
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
