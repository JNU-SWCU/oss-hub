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
    return {
      id: review.id,
      decision: review.decision,
      comment: review.comment,
      reviewedAt: review.reviewedAt.toISOString(),
    };
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
    return {
      fileId: file.fileId,
      fileName: file.fileName,
      contentType: file.contentType,
      size: file.size,
      expiresAt: file.expiresAt.toISOString(),
      downloadUrl: file.downloadUrl,
    };
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
      number: revision.number,
      content: revision.content,
      comment: revision.comment,
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
      submissionId: context.submissionId,
      application: context.application,
      milestone: context.milestone,
      currentRevision: SubmissionRevisionResponseDto.from(
        context.currentRevision,
      ),
      history: context.history.map((revision) =>
        SubmissionRevisionResponseDto.from(revision),
      ),
      repository: context.repository,
    };
  }
}

export class CreateSubmissionReviewResponseDto {
  declare readonly reviewId: string;
  declare readonly submissionStatus: SubmissionReviewResult['submissionStatus'];

  static from(
    result: SubmissionReviewResult,
  ): CreateSubmissionReviewResponseDto {
    return {
      reviewId: result.reviewId,
      submissionStatus: result.submissionStatus,
    };
  }
}

export class RepositoryPublishResponseDto {
  declare readonly repositoryId: string;
  declare readonly visibility: RepositoryPublishResult['visibility'];
  declare readonly publishedAt: string;

  static from(result: RepositoryPublishResult): RepositoryPublishResponseDto {
    return {
      repositoryId: result.repositoryId,
      visibility: result.visibility,
      publishedAt: result.publishedAt.toISOString(),
    };
  }
}
