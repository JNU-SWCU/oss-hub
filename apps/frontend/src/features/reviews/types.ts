import type {
  PublishBlockedReason,
  PublishRepositoryResponse,
  RepositoryPublication,
  RepositoryVisibility,
} from '@/lib/repository-publication';

export type {
  PublishBlockedReason,
  PublishRepositoryResponse,
  RepositoryVisibility,
};

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export type ApplicationMode = 'PERSONAL' | 'TEAM';

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

/**
 * 백엔드 제출 본문 계약(`apps/backend/src/submissions/domain/submission-content.ts`)과
 * 한 벌이다. 서버는 이 두 형태 중 하나를 그대로 전달한다.
 */
export interface SubmissionTextContent {
  readonly type: 'TEXT';
  readonly text: string;
}

export interface SubmissionFileContent {
  readonly type: 'FILE';
  readonly fileId: string;
}

export type SubmissionRevisionContent =
  SubmissionTextContent | SubmissionFileContent;

export interface SubmissionRevision {
  readonly number: number;
  readonly content: SubmissionRevisionContent;
  readonly comment: string | null;
  readonly submittedAt: string;
  readonly files: readonly SubmissionRevisionFile[];
  readonly review: ReviewRecord | null;
}

/**
 * 공개 확정 게이트 2~5의 실패 사유.
 * 백엔드 `PUBLISH_BLOCKED_REASONS`(domain/submission-review.ts)와 한 벌이며 서버가 거절하는 조건과 같다.
 */
export interface ReviewRepository extends RepositoryPublication {}

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
