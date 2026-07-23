import type {
  Prisma,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';

export const APPLICATION_MODES = {
  PERSONAL: 'PERSONAL',
  TEAM: 'TEAM',
} as const;

export type ApplicationMode =
  (typeof APPLICATION_MODES)[keyof typeof APPLICATION_MODES];

export const PUBLISH_BLOCKED_REASONS = {
  REPOSITORY_NOT_READY: 'REPOSITORY_NOT_READY',
  REQUIRED_MILESTONES_NOT_APPROVED: 'REQUIRED_MILESTONES_NOT_APPROVED',
} as const;

export type PublishBlockedReason =
  (typeof PUBLISH_BLOCKED_REASONS)[keyof typeof PUBLISH_BLOCKED_REASONS];

export interface SubmissionReviewRecord {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}

export interface SubmissionRevisionRecord {
  readonly number: number;
  readonly content: Prisma.JsonValue;
  readonly comment: string | null;
  readonly submittedAt: Date;
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

export interface RepositoryPublishEligibility {
  readonly repositoryId: string;
  readonly visibility: RepositoryVisibility;
  readonly provisionStatus: RepositoryProvisionJobStatus | null;
  readonly requiredMilestonesApproved: boolean;
}

export interface RepositoryPublishResult {
  readonly repositoryId: string;
  readonly visibility: typeof RepositoryVisibility.PUBLIC;
  readonly publishedAt: Date;
}
