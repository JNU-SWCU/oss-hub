import type {
  PublishBlockedReason,
  RepositoryPublication,
} from '@/lib/repository-publication';

export type { PublishBlockedReason };

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export type ApplicationMode = 'PERSONAL' | 'TEAM';

interface ReviewRecord {
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

interface SubmissionTextContent {
  readonly type: 'TEXT';
  readonly text: string;
}

interface SubmissionFileContent {
  readonly type: 'FILE';
  readonly fileId: string;
}

type SubmissionRevisionContent = SubmissionTextContent | SubmissionFileContent;

export interface SubmissionRevision {
  readonly number: number;
  readonly content: SubmissionRevisionContent;
  readonly comment: string | null;
  readonly submittedAt: string;
  readonly files: readonly SubmissionRevisionFile[];
  readonly review: ReviewRecord | null;
}

export type ReviewRepository = RepositoryPublication;

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
