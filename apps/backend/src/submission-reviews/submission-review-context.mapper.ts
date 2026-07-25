import {
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  SubmissionStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  APPLICATION_MODES,
  PUBLISH_BLOCKED_REASONS,
  type SubmissionReviewContext,
  type SubmissionRevisionRecord,
} from './domain/submission-review';

export const REVIEW_CONTEXT_SELECT = {
  id: true,
  currentRevision: true,
  application: {
    select: {
      id: true,
      teamId: true,
      applicant: { select: { name: true, login: true } },
      team: { select: { name: true } },
      program: { select: { milestones: { select: { id: true } } } },
      submissions: { select: { milestoneId: true, status: true } },
      repository: {
        select: {
          id: true,
          url: true,
          visibility: true,
          provisionJob: { select: { status: true, repositoryId: true } },
        },
      },
    },
  },
  milestone: { select: { id: true, name: true } },
  revisions: {
    orderBy: { revision: 'desc' as const },
    select: {
      revision: true,
      content: true,
      comment: true,
      submittedAt: true,
      review: {
        select: {
          id: true,
          decision: true,
          comment: true,
          reviewedAt: true,
        },
      },
    },
  },
} satisfies Prisma.SubmissionSelect;

type ReviewContextRow = Prisma.SubmissionGetPayload<{
  select: typeof REVIEW_CONTEXT_SELECT;
}>;

export class SubmissionRevisionInvariantError extends Error {
  override readonly name = 'SubmissionRevisionInvariantError';
}

export function toReviewContext(
  row: ReviewContextRow,
): SubmissionReviewContext {
  const current = row.revisions.find(
    (revision) => revision.revision === row.currentRevision,
  );
  if (current === undefined) {
    throw new SubmissionRevisionInvariantError();
  }
  const repository = row.application.repository;
  const allApproved = requiredMilestonesApproved(
    row.application.program.milestones,
    row.application.submissions,
  );
  const isReady =
    repository?.provisionJob?.status ===
      RepositoryProvisionJobStatus.SUCCEEDED &&
    repository.provisionJob.repositoryId === repository.id;
  const blockedReasons = repository
    ? [
        ...(isReady ? [] : [PUBLISH_BLOCKED_REASONS.REPOSITORY_NOT_READY]),
        ...(allApproved
          ? []
          : [PUBLISH_BLOCKED_REASONS.REQUIRED_MILESTONES_NOT_APPROVED]),
      ]
    : [];
  return {
    submissionId: row.id,
    application: {
      id: row.application.id,
      applicationMode:
        row.application.teamId === null
          ? APPLICATION_MODES.PERSONAL
          : APPLICATION_MODES.TEAM,
      displayName:
        row.application.team?.name ??
        row.application.applicant.name ??
        row.application.applicant.login,
    },
    milestone: row.milestone,
    currentRevision: toRevisionRecord(current),
    history: row.revisions
      .filter((revision) => revision.revision !== row.currentRevision)
      .map(toRevisionRecord),
    repository: repository
      ? {
          id: repository.id,
          url: repository.url,
          visibility: repository.visibility,
          publishEligible:
            repository.visibility === RepositoryVisibility.PUBLIC ||
            blockedReasons.length === 0,
          blockedReasons:
            repository.visibility === RepositoryVisibility.PUBLIC
              ? []
              : blockedReasons,
        }
      : null,
  };
}

export function requiredMilestonesApproved(
  milestones: readonly { readonly id: string }[],
  submissions: readonly {
    readonly milestoneId: string;
    readonly status: SubmissionStatus;
  }[],
): boolean {
  const statusByMilestone = new Map(
    submissions.map((submission) => [
      submission.milestoneId,
      submission.status,
    ]),
  );
  return milestones.every(
    (milestone) =>
      statusByMilestone.get(milestone.id) === SubmissionStatus.APPROVED,
  );
}

function toRevisionRecord(
  revision: ReviewContextRow['revisions'][number],
): SubmissionRevisionRecord {
  return {
    number: revision.revision,
    content: revision.content,
    comment: revision.comment,
    submittedAt: revision.submittedAt,
    review: revision.review,
  };
}
