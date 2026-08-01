import {
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
import { safeSubmissionFileContentType } from '../submissions/submission-file-content-type';
import {
  APPLICATION_MODES,
  PUBLISH_BLOCKED_REASONS,
  type SubmissionReviewContext,
  type SubmissionReviewFileRecord,
  type SubmissionRevisionRecord,
} from './domain/submission-review';

export const REVIEW_CONTEXT_SELECT = {
  id: true,
  currentRevision: true,
  application: {
    select: {
      id: true,
      teamId: true,
      applicant: {
        select: {
          nickname: true,
          ...COMPATIBLE_PROFILE_NAME_SELECT,
        },
      },
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
      files: {
        orderBy: { id: 'asc' as const },
        select: {
          id: true,
          originalFileName: true,
          mimeType: true,
          sizeBytes: true,
          expiresAt: true,
          lifecycle: true,
        },
      },
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
  now: Date = new Date(),
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
        resolveCompatibleProfileName(row.application.applicant) ??
        row.application.applicant.nickname,
    },
    milestone: row.milestone,
    currentRevision: toRevisionRecord(current, now),
    history: row.revisions
      .filter((revision) => revision.revision !== row.currentRevision)
      .map((revision) => toRevisionRecord(revision, now)),
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
  now: Date,
): SubmissionRevisionRecord {
  return {
    number: revision.revision,
    content: revision.content,
    comment: revision.comment,
    submittedAt: revision.submittedAt,
    files: revision.files.flatMap((file) => toFileRecord(file, now)),
    review: revision.review,
  };
}

function toFileRecord(
  file: ReviewContextRow['revisions'][number]['files'][number],
  now: Date,
): readonly SubmissionReviewFileRecord[] {
  if (
    file.lifecycle !== SubmissionFileLifecycle.ATTACHED ||
    file.expiresAt === null ||
    file.expiresAt.getTime() <= now.getTime()
  ) {
    return [];
  }
  return [
    {
      fileId: file.id,
      fileName: file.originalFileName,
      contentType: safeSubmissionFileContentType(
        file.originalFileName,
        file.mimeType,
      ),
      size: file.sizeBytes,
      expiresAt: file.expiresAt,
      downloadUrl: `/api/v1/submission-files/${file.id}`,
    },
  ];
}
