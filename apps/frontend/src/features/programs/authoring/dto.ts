import type { ProgramTrackType, SubmissionType } from '../program-contract';

interface CreateProgramInput {
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly endAt: string;
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
  readonly description: string;
}

export interface EditableMilestone {
  readonly id: string;
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly submissionType: SubmissionType | null;
  readonly instructions: string | null;
}

export interface EditableMilestoneDocument {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly templateFileName: string | null;
}

export interface EditableMilestoneEditSnapshot {
  readonly milestone: EditableMilestone;
  readonly operation: {
    readonly startAt: string;
    readonly endAt: string;
  };
  readonly documents: readonly EditableMilestoneDocument[];
  readonly fileUpload: {
    readonly maxBytes: number;
    readonly maxLabel: string;
    readonly accept: string;
    readonly formatLabel: string;
  };
  readonly fingerprint: string;
}

export type UpdateEditableMilestoneDocumentInput = {
  readonly id: string | null;
  readonly name: string;
  readonly required: boolean;
  readonly templateUploadId?: string;
};

export type UpdateEditableMilestoneInput = {
  readonly expectedFingerprint: string;
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly instructions: string | null;
  readonly documents: readonly UpdateEditableMilestoneDocumentInput[];
};

export type EditableMilestoneSnapshotFailure =
  | { readonly kind: 'conflict' }
  | {
      readonly kind: 'known';
      readonly message: string;
      readonly fieldErrors: readonly {
        readonly field: string;
        readonly message: string;
        readonly code: string;
      }[];
    }
  | { readonly kind: 'unknown' };

export interface ProgramDeletionScopeCounts {
  readonly applications: number;
  readonly teams: number;
  readonly boardPosts: number;
  readonly submissions: number;
  readonly submissionEvents: number;
  readonly scopeFingerprint: string;
}

export interface EditableProgram {
  readonly coverImageUrl?: string | null;
  readonly externalCover?:
    import('./program-cover-selection').ExternalProgramCover | null;
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  readonly lifecycle: 'PUBLISHED' | 'ARCHIVED';
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationCount: number;

  readonly deletionScopeCounts?: ProgramDeletionScopeCounts;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;

  readonly startAt: string;
  readonly endAt: string | null;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
  readonly description: string;
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
  readonly milestones: readonly EditableMilestone[];
}

export type UpdateProgramInput = Omit<CreateProgramInput, 'endAt'> & {
  readonly coverUploadId?: string | null;
  readonly externalCover?:
    import('./program-cover-selection').ExternalProgramCover | null;
  readonly startAt: string;
  readonly endAt: string | null;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
};

export interface UpsertMilestoneInput {
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly instructions: string | null;
}

export interface ProgramPurgeDeletedCounts {
  readonly applications: number;
  readonly teams: number;
  readonly teamMembers: number;
  readonly teamInvitations: number;
  readonly boardPosts: number;
  readonly boardComments: number;
  readonly submissions: number;
  readonly submissionRevisions: number;
  readonly reviews: number;
  readonly submissionFiles: number;
  readonly milestones: number;
  readonly milestoneDocuments: number;
  readonly milestoneDocumentSubmissions: number;
  readonly milestoneDocumentSubmissionHistories: number;
  readonly milestoneDocumentReviewHistories: number;
  readonly milestoneDocumentTemplateFiles: number;
  readonly programAuthoringUploads: number;
  readonly programCreateRequests: number;
  readonly repositoryProvisionJobs: number;
  readonly githubRepositoriesDetached: number;
  readonly outboxEvents: number;
  readonly notifications: number;
  readonly programPurgeFileTombstones: number;
}

export interface ProgramPurgeResult {
  readonly id: string;
  readonly deleted: true;
  readonly deletedCounts: ProgramPurgeDeletedCounts;
}
