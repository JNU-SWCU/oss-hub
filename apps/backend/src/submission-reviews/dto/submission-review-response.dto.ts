import type { RepositoryVisibility, ReviewDecision } from '@prisma/client';
import type {
  PublishBlockedReason,
  RepositoryPublishResult,
  SubmissionReviewContext,
  SubmissionReviewFileRecord,
  SubmissionReviewRecord,
  SubmissionReviewResult,
  SubmissionRevisionRecord,
} from '../domain/submission-review';

export interface SubmissionReviewResponseDto {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;
}

export interface SubmissionRevisionResponseDto {
  readonly number: number;
  readonly content: unknown;
  readonly comment: string | null;
  readonly submittedAt: string;
  readonly files: readonly SubmissionReviewFileResponseDto[];
  readonly review: SubmissionReviewResponseDto | null;
}

export interface SubmissionReviewFileResponseDto extends Omit<
  SubmissionReviewFileRecord,
  'expiresAt'
> {
  readonly expiresAt: string;
}

export interface SubmissionReviewContextResponseDto {
  readonly submissionId: string;
  readonly application: SubmissionReviewContext['application'];
  readonly milestone: SubmissionReviewContext['milestone'];
  readonly currentRevision: SubmissionRevisionResponseDto;
  readonly history: readonly SubmissionRevisionResponseDto[];
  readonly repository: {
    readonly id: string;
    readonly url: string;
    readonly visibility: RepositoryVisibility;
    readonly publishEligible: boolean;
    readonly blockedReasons: readonly PublishBlockedReason[];
  } | null;
}

export interface CreateSubmissionReviewResponseDto {
  readonly reviewId: string;
  readonly submissionStatus: SubmissionReviewResult['submissionStatus'];
}

export interface RepositoryPublishResponseDto {
  readonly repositoryId: string;
  readonly visibility: RepositoryPublishResult['visibility'];
  readonly publishedAt: string;
}

export function toReviewContextResponse(
  context: SubmissionReviewContext,
): SubmissionReviewContextResponseDto {
  return {
    ...context,
    currentRevision: toRevisionResponse(context.currentRevision),
    history: context.history.map(toRevisionResponse),
  };
}

export function toCreateReviewResponse(
  result: SubmissionReviewResult,
): CreateSubmissionReviewResponseDto {
  return result;
}

export function toRepositoryPublishResponse(
  result: RepositoryPublishResult,
): RepositoryPublishResponseDto {
  return { ...result, publishedAt: result.publishedAt.toISOString() };
}

function toRevisionResponse(
  revision: SubmissionRevisionRecord,
): SubmissionRevisionResponseDto {
  return {
    ...revision,
    submittedAt: revision.submittedAt.toISOString(),
    files: revision.files.map(toFileResponse),
    review: revision.review ? toReviewResponse(revision.review) : null,
  };
}

function toFileResponse(
  file: SubmissionReviewFileRecord,
): SubmissionReviewFileResponseDto {
  return { ...file, expiresAt: file.expiresAt.toISOString() };
}

function toReviewResponse(
  review: SubmissionReviewRecord,
): SubmissionReviewResponseDto {
  return { ...review, reviewedAt: review.reviewedAt.toISOString() };
}
