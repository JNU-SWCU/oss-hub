import { SubmissionFileLifecycle, SubmissionStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
import { safeSubmissionFileContentType } from '../submissions/submission-file-content-type';
import {
  APPLICATION_MODES,
  publishBlockedReasons,
  type RepositoryPublishEligibility,
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
      // 공개 게이트의 재료다 — 빠지면 화면이 서버보다 적은 조건으로 버튼을 열어 준다.
      // 집합은 submission-reviews.repository.ts 의 findPublishEligibility 와 같아야 한다.
      isRepositoryPublicationPlanned: true,
      program: {
        select: { endAt: true, milestones: { select: { id: true } } },
      },
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
  const blockedReasons = repository
    ? publishBlockedReasons(
        toPublishEligibility(row.application, repository),
        now,
      )
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
          publishEligible: blockedReasons.length === 0,
          blockedReasons,
        }
      : null,
  };
}

/**
 * 검토 화면의 행을 공개 게이트가 보는 모양으로 옮긴다.
 * `findPublishEligibility`가 만드는 것과 같은 값이어야 한다 — 다르면 화면과 서버가 갈라진다.
 */
function toPublishEligibility(
  application: ReviewContextRow['application'],
  repository: NonNullable<ReviewContextRow['application']['repository']>,
): Omit<RepositoryPublishEligibility, 'repositoryId'> {
  const job = repository.provisionJob;
  return {
    visibility: repository.visibility,
    // ⚠ 이 경로에서는 `repositoryId` 대조가 늘 참이다(Prisma 가 저장소로 이어 준 job 이라서).
    // 그래도 남겨 둔다 — `findPublishEligibility` 는 신청으로 도달해 이 대조가 실제로 걸러 내고,
    // 두 조회가 같은 값을 만든다는 것이 이 함수의 존재 이유다.
    provisionStatus: job?.repositoryId === repository.id ? job.status : null,
    requiredMilestonesApproved: requiredMilestonesApproved(
      application.program.milestones,
      application.submissions,
    ),
    isRepositoryPublicationPlanned: application.isRepositoryPublicationPlanned,
    programEndAt: application.program.endAt,
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
