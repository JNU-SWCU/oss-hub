import {
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  SubmissionFileLifecycle,
  type ReviewDecision,
  RepositoryVisibility,
  type SubmissionStatus,
} from '@prisma/client';
import {
  USER_PROFILE_NAME_SELECT,
  UserProfileReadRepository,
} from '../platform/user-profile-read.repository';
import { SubmissionRevisionInvariantError } from './submission-review-context-mapper.error';
import {
  type PublishBlockedReason,
  repositoryUrlFromNameWithOwner,
  publishBlockedReasons,
  type RepositoryPublishEligibility,
} from '../github/repositories.repository';
import { requiredMilestonesApproved } from './submissions.repository';
import {
  safeSubmissionFileContentType,
  publicSubmissionId,
} from './submission-checklist-record.repository';

type JsonObject = { [key in string]?: JsonValue };

type JsonArray = JsonValue[];

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;

export type SubmissionRevisionContent = JsonValue;

const APPLICATION_MODES = {
  PERSONAL: 'PERSONAL',
  TEAM: 'TEAM',
} as const;

type ApplicationMode =
  (typeof APPLICATION_MODES)[keyof typeof APPLICATION_MODES];

export interface SubmissionReviewRecord {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}

export interface SubmissionReviewFileRecord {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: Date;
  readonly downloadUrl: string;
}

export interface SubmissionRevisionRecord {
  readonly number: number;
  readonly content: SubmissionRevisionContent;
  readonly comment: string | null;
  readonly submittedAt: Date;
  readonly files: readonly SubmissionReviewFileRecord[];
  readonly review: SubmissionReviewRecord | null;
}

export interface SubmissionReviewContext {
  readonly submissionId: string;
  readonly application: {
    readonly id: string;
    readonly applicationMode: ApplicationMode;
    readonly displayName: string;
  };
  readonly milestone: { readonly id: string; readonly name: string };
  readonly currentRevision: SubmissionRevisionRecord;
  readonly history: readonly SubmissionRevisionRecord[];
  readonly repository: {
    readonly id: string;
    readonly url: string;
    readonly visibility: RepositoryVisibility;
    readonly publishEligible: boolean;
    readonly blockedReasons: readonly PublishBlockedReason[];
  } | null;
}

export interface CreateSubmissionReviewInput {
  readonly revision: number;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
}

export interface SubmissionReviewTarget {
  readonly id: string;
  readonly currentRevision: number;
  readonly status: SubmissionStatus;
  readonly revision: {
    readonly id: string;
    readonly reviewId: string | null;
  };
}

export interface SubmissionReviewResult {
  readonly reviewId: string;
  readonly submissionStatus: SubmissionStatus;
}

export interface RepositoryPublishResult {
  readonly repositoryId: string;
  readonly visibility: typeof RepositoryVisibility.PUBLIC;
  readonly publishedAt: Date;
}

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
      provisionJob: { select: { status: true, repositoryId: true } },
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

export class SubmissionReviewContextMapperRepository {
  static toReviewContext(
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
          UserProfileReadRepository.resolveUserProfileName(
            row.application.applicant,
          ) ??
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
  const job = application.provisionJob;
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
