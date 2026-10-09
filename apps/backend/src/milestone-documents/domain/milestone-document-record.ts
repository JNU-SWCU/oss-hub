import type { ReviewDecision, SubmissionStatus } from '@prisma/client';
import type { MilestoneDocumentReviewRecord } from './milestone-document-review';

type JsonValue =
  | string
  | number
  | boolean
  | { [key: string]: JsonValue | undefined }
  | JsonValue[]
  | null;

export interface MilestoneDocumentRecord {
  id: string;
  milestoneId: string;
  name: string;
  required: boolean;
  sortOrder: number;
  templateFileId: string | null;
  templateFileName: string | null;
}
export interface MilestoneContext {
  readonly id: string;
  readonly programId: string;
  readonly name: string;
  readonly dueAt: Date;
}
export interface MilestoneDocumentCollectionApplication {
  readonly applicationId: string;
  readonly teamName: string;
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
}
export interface MilestoneDocumentCollectionSubmission {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
  readonly submittedAt: Date;
  readonly revision: number;
  readonly status: SubmissionStatus;
  readonly file: {
    readonly originalFileName: string;
    readonly sizeBytes: number;
  } | null;
  readonly content: JsonValue | null;
  readonly review: MilestoneDocumentReviewRecord | null;
}
export interface CreatedMilestoneDocumentReview {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
  readonly resubmissionDueAt: Date | null;
  readonly reviewerNickname: string;
}
export interface MilestoneDocumentSubmissionFile {
  readonly id: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}
export interface MilestoneDocumentSubmissionDetail {
  readonly id: string;
  readonly status: SubmissionStatus;
  readonly content: JsonValue | null;
  readonly submittedAt: Date;
  readonly files: readonly MilestoneDocumentSubmissionFile[];
}
export interface UpsertMilestoneDocumentInput {
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
}
