import {
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  SubmissionFileLifecycle,
} from '@prisma/client';
import { requiredMilestonesApproved } from '../common/milestone-completion';
import { repositoryUrlFromNameWithOwner } from '../github/repository-identity';
import {
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../profiles/user-profile-read';
import { safeSubmissionFileContentType } from '../submissions/submission-file-content-type';
import { publicSubmissionId } from '../submissions/submission-public-id';
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
  legacySubmissionId: true,
  revision: true,
  application: {
    select: {
      id: true,
      teamId: true,
      applicant: {
        select: { nickname: true, ...USER_PROFILE_NAME_SELECT },
      },
      team: { select: { name: true } },
      isRepositoryPublicationPlanned: true,
      program: {
        select: {
          endAt: true,
          milestones: {
            select: {
              id: true,
              submissionType: true,
              documents: {
                where: {
                  required: true,
                  kind: MilestoneDocumentKind.DOCUMENT,
                },
                select: { id: true },
              },
            },
          },
        },
      },
      milestoneDocumentSubmissions: {
        select: {
          status: true,
          milestoneDocument: {
            select: { id: true, milestoneId: true, kind: true },
          },
        },
      },
      repository: {
        select: {
          id: true,
          nameWithOwner: true,
          visibility: true,
          provisionJob: { select: { status: true, repositoryId: true } },
        },
      },
    },
  },
  milestoneDocument: {
    select: { milestone: { select: { id: true, name: true } } },
  },
  histories: {
    where: {
      event: {
        in: [
          MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
          MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
        ],
      },
    },
    orderBy: [{ revision: 'desc' as const }, { id: 'desc' as const }],
    select: {
      id: true,
      revision: true,
      content: true,
      comment: true,
      createdAt: true,
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
      reviewHistories: {
        orderBy: [{ reviewedAt: 'desc' as const }, { id: 'desc' as const }],
        take: 1,
        select: {
          id: true,
          decision: true,
          comment: true,
          reviewedAt: true,
        },
      },
    },
  },
} satisfies Prisma.MilestoneDocumentSubmissionSelect;

export type ReviewContextRow = Prisma.MilestoneDocumentSubmissionGetPayload<{
  select: typeof REVIEW_CONTEXT_SELECT;
}>;

export class SubmissionRevisionInvariantError extends Error {
  override readonly name = 'SubmissionRevisionInvariantError';
}

export function toReviewContext(
  row: ReviewContextRow,
  now: Date = new Date(),
): SubmissionReviewContext {
  const current = row.histories.find(
    (history) => history.revision === row.revision,
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
    submissionId: publicSubmissionId(row),
    application: {
      id: row.application.id,
      applicationMode:
        row.application.teamId === null
          ? APPLICATION_MODES.PERSONAL
          : APPLICATION_MODES.TEAM,
      displayName:
        row.application.team?.name ??
        resolveUserProfileName(row.application.applicant) ??
        row.application.applicant.nickname,
    },
    milestone: row.milestoneDocument.milestone,
    currentRevision: toRevisionRecord(current, now),
    history: row.histories
      .filter((history) => history.id !== current.id)
      .map((history) => toRevisionRecord(history, now)),
    repository: repository
      ? {
          id: repository.id,
          url: repositoryUrlFromNameWithOwner(repository.nameWithOwner),
          visibility: repository.visibility,
          publishEligible: blockedReasons.length === 0,
          blockedReasons,
        }
      : null,
  };
}

function toPublishEligibility(
  application: ReviewContextRow['application'],
  repository: NonNullable<ReviewContextRow['application']['repository']>,
): Omit<RepositoryPublishEligibility, 'repositoryId'> {
  const targetSubmissions = application.milestoneDocumentSubmissions;
  const legacySubmissions = targetSubmissions
    .filter(
      (submission) =>
        submission.milestoneDocument.kind ===
        MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
    )
    .map((submission) => ({
      milestoneId: submission.milestoneDocument.milestoneId,
      status: submission.status,
    }));
  const documentSubmissions = targetSubmissions
    .filter(
      (submission) =>
        submission.milestoneDocument.kind === MilestoneDocumentKind.DOCUMENT,
    )
    .map((submission) => ({
      milestoneDocumentId: submission.milestoneDocument.id,
      status: submission.status,
    }));
  const job = repository.provisionJob;
  return {
    visibility: repository.visibility,
    provisionStatus: job?.repositoryId === repository.id ? job.status : null,
    requiredMilestonesApproved: requiredMilestonesApproved(
      application.program.milestones,
      legacySubmissions,
      documentSubmissions,
    ),
    isRepositoryPublicationPlanned: application.isRepositoryPublicationPlanned,
    programEndAt: application.program.endAt,
  };
}

function toRevisionRecord(
  history: ReviewContextRow['histories'][number],
  now: Date,
): SubmissionRevisionRecord {
  if (history.revision === null) {
    throw new SubmissionRevisionInvariantError();
  }
  return {
    number: history.revision,
    content: history.content,
    comment: history.comment,
    submittedAt: history.createdAt,
    files: history.files.flatMap((file) => toFileRecord(file, now)),
    review: history.reviewHistories[0] ?? null,
  };
}

function toFileRecord(
  file: ReviewContextRow['histories'][number]['files'][number],
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
      contentType: safeSubmissionFileContentType(file.originalFileName),
      size: file.sizeBytes,
      expiresAt: file.expiresAt,
      downloadUrl: `/api/v1/submission-files/${file.id}`,
    },
  ];
}
