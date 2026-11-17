import type {
  SubmissionReviewContext,
  SubmissionReviewFileRecord,
  SubmissionReviewRecord,
  SubmissionReviewResult,
  SubmissionRevisionRecord,
  SubmissionRevisionContent,
  SubmissionReviewDecision,
} from '../submissions.repository';
import { PublishableRepositoryResponseDto } from './publishable-repository-response.dto';
export class SubmissionReviewResponseDto {
  declare readonly id: string;
  declare readonly decision: SubmissionReviewDecision;
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
  declare readonly size: number;
  declare readonly downloadUrl: string;
  static from(
    file: SubmissionReviewFileRecord,
  ): SubmissionReviewFileResponseDto {
    return {
      fileId: file.fileId,
      fileName: file.fileName,
      size: file.size,
      downloadUrl: file.downloadUrl,
    };
  }
}
export class SubmissionRevisionResponseDto {
  declare readonly number: number;
  declare readonly content: SubmissionRevisionContent;
  declare readonly comment: string | null;
  declare readonly submittedAt: string;
  declare readonly files: SubmissionReviewFileResponseDto[];
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
  declare readonly latestReviewId: string | null;
  declare readonly requirementId: string;
  declare readonly submissionId: string;
  declare readonly application: {
    readonly id: string;
    readonly applicationMode: SubmissionReviewContext['application']['applicationMode'];
    readonly displayName: string;
  };
  declare readonly milestone: {
    readonly id: string;
    readonly name: string;
  };
  declare readonly currentRevision: SubmissionRevisionResponseDto;
  declare readonly history: SubmissionRevisionResponseDto[];
  declare readonly unversionedReviews?: SubmissionReviewResponseDto[];
  declare readonly repository: PublishableRepositoryResponseDto | null;
  static from(
    context: SubmissionReviewContext,
  ): SubmissionReviewContextResponseDto {
    return {
      requirementId: context.requirementId,
      latestReviewId: context.latestReviewId,
      submissionId: context.submissionId,
      application: context.application,
      milestone: context.milestone,
      currentRevision: SubmissionRevisionResponseDto.from(
        context.currentRevision,
      ),
      history: context.history.map((revision) =>
        SubmissionRevisionResponseDto.from(revision),
      ),
      unversionedReviews: context.unversionedReviews?.length
        ? context.unversionedReviews.map((review) =>
            SubmissionReviewResponseDto.from(review),
          )
        : undefined,
      repository: context.repository
        ? PublishableRepositoryResponseDto.from(context.repository)
        : null,
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
