export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export type ApplicationMode = 'PERSONAL' | 'TEAM';
export type RepositoryVisibility = 'PRIVATE' | 'PUBLIC';

export interface ReviewRecord {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;
}

export interface SubmissionRevisionFile {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
  readonly downloadUrl: string;
}

export interface SubmissionRevision {
  readonly number: number;
  readonly content: unknown;
  readonly comment: string | null;
  readonly submittedAt: string;
  readonly files: readonly SubmissionRevisionFile[];
  readonly review: ReviewRecord | null;
}

/**
 * 공개 확정 게이트 2~5의 실패 사유.
 * 백엔드 `PUBLISH_BLOCKED_REASONS`(domain/submission-review.ts)와 한 벌이며 서버가 거절하는 조건과 같다.
 */
export type PublishBlockedReason =
  | 'REPOSITORY_NOT_READY'
  | 'REPOSITORY_PUBLICATION_NOT_PLANNED'
  | 'PROGRAM_NOT_ENDED'
  | 'REQUIRED_MILESTONES_NOT_APPROVED';

export interface ReviewRepository {
  readonly id: string;
  readonly url: string;
  readonly visibility: RepositoryVisibility;
  readonly publishEligible: boolean;
  readonly blockedReasons: readonly PublishBlockedReason[];
}

export interface ReviewContext {
  readonly submissionId: string;
  readonly application: {
    readonly id: string;
    readonly applicationMode: ApplicationMode;
    readonly displayName: string;
  };
  readonly milestone: {
    readonly id: string;
    readonly name: string;
  };
  readonly currentRevision: SubmissionRevision;
  readonly history: readonly SubmissionRevision[];
  readonly repository: ReviewRepository | null;
}

export interface CreateReviewRequest {
  readonly revision: number;
  readonly decision: ReviewDecision;
  readonly comment?: string;
}

export interface CreateReviewResponse {
  readonly reviewId: string;
  readonly submissionStatus: ReviewDecision;
}

export interface PublishRepositoryResponse {
  readonly repositoryId: string;
  readonly visibility: 'PUBLIC';
  readonly publishedAt: string;
}
