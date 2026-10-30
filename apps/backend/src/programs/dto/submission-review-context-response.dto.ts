import type { RepositoryVisibility, ReviewDecision } from '@prisma/client';
import type {
  PublishBlockedReason,
  RepositoryPublishResult,
  SubmissionReviewContext,
  SubmissionReviewFileRecord,
  SubmissionReviewRecord,
  SubmissionReviewResult,
  SubmissionRevisionRecord,
  SubmissionRevisionContent,
} from '../submission-review.types';

export class SubmissionReviewResponseDto {
  declare readonly id: string;
  declare readonly decision: ReviewDecision;
  declare readonly comment: string | null;
  declare readonly reviewedAt: string;

  static from(review: SubmissionReviewRecord): SubmissionReviewResponseDto {
    return { ...review, reviewedAt: review.reviewedAt.toISOString() };
  }
}

export class SubmissionReviewFileResponseDto {
  declare readonly fileId: string;
  declare readonly fileName: string;
  declare readonly contentType: string;
  declare readonly size: number;
  declare readonly expiresAt: string;
  declare readonly downloadUrl: string;

  static from(
    file: SubmissionReviewFileRecord,
  ): SubmissionReviewFileResponseDto {
    return { ...file, expiresAt: file.expiresAt.toISOString() };
  }
}

export class SubmissionRevisionResponseDto {
  declare readonly number: number;
  declare readonly content: SubmissionRevisionContent;
  declare readonly comment: string | null;
  declare readonly submittedAt: string;
  declare readonly files: readonly SubmissionReviewFileResponseDto[];
  declare readonly review: SubmissionReviewResponseDto | null;

  static from(
    revision: SubmissionRevisionRecord,
  ): SubmissionRevisionResponseDto {
    return {
      ...revision,
      submittedAt: revision.submittedAt.toISOString(),
      files: revision.files.map((file) =>
        SubmissionReviewFileResponseDto.from(file),
      ),
      review: revision.review
        ? SubmissionReviewResponseDto.from(revision.review)
        : null,
    };
  }
}

export class SubmissionReviewContextResponseDto {
  declare readonly submissionId: string;
  declare readonly application: SubmissionReviewContext['application'];
  declare readonly milestone: SubmissionReviewContext['milestone'];
  declare readonly currentRevision: SubmissionRevisionResponseDto;
  declare readonly history: readonly SubmissionRevisionResponseDto[];
  declare readonly repository: {
    readonly id: string;
    readonly url: string;
    readonly visibility: RepositoryVisibility;
    readonly publishEligible: boolean;
    readonly blockedReasons: readonly PublishBlockedReason[];
  } | null;

  static from(
    context: SubmissionReviewContext,
  ): SubmissionReviewContextResponseDto {
    return {
      ...context,
      currentRevision: SubmissionRevisionResponseDto.from(
        context.currentRevision,
      ),
      history: context.history.map((revision) =>
        SubmissionRevisionResponseDto.from(revision),
      ),
    };
  }
}

export class CreateSubmissionReviewResponseDto {
  declare readonly reviewId: string;
  declare readonly submissionStatus: SubmissionReviewResult['submissionStatus'];

  static from(
    result: SubmissionReviewResult,
  ): CreateSubmissionReviewResponseDto {
    return { ...result };
  }
}

export class RepositoryPublishResponseDto {
  declare readonly repositoryId: string;
  declare readonly visibility: RepositoryPublishResult['visibility'];
  declare readonly publishedAt: string;

  static from(result: RepositoryPublishResult): RepositoryPublishResponseDto {
    return { ...result, publishedAt: result.publishedAt.toISOString() };
  }
}
