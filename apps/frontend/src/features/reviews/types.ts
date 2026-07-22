export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export type ApplicationMode = 'PERSONAL' | 'TEAM';
export type RepositoryVisibility = 'PRIVATE' | 'PUBLIC';

export interface ReviewRecord {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;
}

export interface SubmissionRevision {
  readonly number: number;
  readonly content: unknown;
  readonly comment: string | null;
  readonly submittedAt: string;
  readonly review: ReviewRecord | null;
}

export interface ReviewRepository {
  readonly id: string;
  readonly url: string;
  readonly visibility: RepositoryVisibility;
  readonly publishEligible: boolean;
  readonly blockedReasons: readonly string[];
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
