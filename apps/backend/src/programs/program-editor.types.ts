import type {
  AccountStatus,
  MilestoneSubmissionType,
  ProgramLifecycle,
  ProgramTrackType,
  StaffAccessRequestStatus,
} from '@prisma/client';
import type { ProgramDeletionScopeCounts } from './domain/program-deletion-scope';
import type { ProgramAuthoringUploadToken } from './program-authoring.types';
import type { ProgramCoverChange } from './domain/program-cover-change';
import type { ProgramExternalCover } from './program-external-cover';

export type ProgramAuthority = {
  readonly id: string;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
  readonly staffAccessRequests: readonly {
    readonly status: StaffAccessRequestStatus;
  }[];
};

export type ProgramMilestoneView = {
  readonly id: string;
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType | null;
  readonly instructions: string | null;
};

export type ProgramMilestoneDocumentView = {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly templateFileName: string | null;
};

export type ProgramMilestoneOperationView = {
  readonly startAt: Date;
  readonly endAt: Date;
};

export type ProgramMilestoneEditView = {
  readonly milestone: ProgramMilestoneView;
  readonly operation: ProgramMilestoneOperationView;
  readonly documents: readonly ProgramMilestoneDocumentView[];
  readonly fingerprint: string;
};

export type LockedProgramMilestoneEdit = {
  readonly programId: string;
  readonly view: Omit<ProgramMilestoneEditView, 'fingerprint'>;
  readonly milestoneUpdatedAt: Date;
  readonly fingerprintDocuments: readonly {
    readonly id: string;
    readonly name: string;
    readonly required: boolean;
    readonly sortOrder: number;
    readonly updatedAt: Date;
    readonly storageKey: string | null;
  }[];
};

export type ApplyProgramMilestoneEditInput = {
  readonly actorId: string;
  readonly milestoneId: string;
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly instructions: string | null;
  readonly documents: readonly {
    readonly id: string | null;
    readonly name: string;
    readonly required: boolean;
    readonly templateUploadId?: string;
  }[];
  readonly uploads: readonly ProgramAuthoringUploadToken[];
};

export type UpdateProgramMilestoneDocumentInput = {
  readonly id: string | null;
  readonly name: string;
  readonly required: boolean;
  readonly templateUploadId?: string;
};

export type UpdateProgramMilestoneInput = {
  readonly milestoneId: string;
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly instructions: string | null;
  readonly documents: readonly UpdateProgramMilestoneDocumentInput[];
  readonly expectedFingerprint: string;
};

export type ProgramCategoryLockState = {
  readonly locked: boolean;
  readonly byApplications: boolean;
  readonly byTeams: boolean;
  readonly applicationCount: number;
  readonly teamCount: number;
};

export type EditableProgramView = {
  readonly externalCover?: ProgramExternalCover | null;
  readonly coverImageUrl?: string | null;
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  readonly lifecycle?: ProgramLifecycle;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationCount: number;
  readonly teamCount: number;

  readonly deletionScopeCounts?: ProgramDeletionScopeCounts;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly startAt: Date;
  readonly endAt: string;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
  readonly description: string;
  readonly milestones: readonly ProgramMilestoneView[];
};

export type ProgramSchedule = {
  readonly id: string;
  readonly startAt: Date;
  readonly endAt: Date;
};

export type ProgramMilestoneDeleteTarget = {
  readonly id: string;
  readonly programId: string;

  readonly documentSubmissionCount: number;
  readonly programMilestoneCount: number;
  readonly programRepositoryProvisioningEnabled: boolean;
};

export type ProgramMilestoneTarget = ProgramMilestoneView & {
  readonly programId: string;
  readonly programStartAt: Date;
  readonly endAt: Date;
};

export type ProgramUpdateInput = {
  readonly coverChange?: ProgramCoverChange;
  readonly programId: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly liveFileExpiresAt: Date | null;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
  readonly description: string;
};

export type ProgramMilestoneInput = {
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly submissionType?: MilestoneSubmissionType | null;
  readonly instructions: string | null;
};

export type ProgramMilestoneCreateInput = ProgramMilestoneInput & {
  readonly programId: string;
};

export type ProgramMilestoneUpdateInput = ProgramMilestoneInput & {
  readonly milestoneId: string;
};

export interface ProgramEditorTransactionStore {
  findUserAuthorityByGithubId(
    githubId: bigint,
  ): Promise<ProgramAuthority | null>;
  findEditableProgramById(
    programId: string,
  ): Promise<EditableProgramView | null>;
  findEditableProgramForUpdate(
    programId: string,
  ): Promise<EditableProgramView | null>;
  updateProgram(input: ProgramUpdateInput): Promise<EditableProgramView>;
  findProgramScheduleForMilestoneCreate(
    programId: string,
  ): Promise<ProgramSchedule | null>;
  createMilestone(
    input: ProgramMilestoneCreateInput,
  ): Promise<ProgramMilestoneView>;

  findMilestoneForUpdate(
    milestoneId: string,
  ): Promise<ProgramMilestoneTarget | null>;

  updateMilestone(
    input: ProgramMilestoneUpdateInput,
  ): Promise<ProgramMilestoneView>;
  findMilestoneForDelete(
    milestoneId: string,
  ): Promise<ProgramMilestoneDeleteTarget | null>;
  deleteMilestone(milestoneId: string): Promise<void>;
  lockMilestoneEdit(
    milestoneId: string,
  ): Promise<LockedProgramMilestoneEdit | null>;
  readMilestoneEdit(
    milestoneId: string,
  ): Promise<LockedProgramMilestoneEdit | null>;
  countSubmissionHistoriesForDocuments(
    documentIds: readonly string[],
  ): Promise<number>;
  lockAttachableUploads(
    actorId: string,
    tokenIds: readonly string[],
  ): Promise<readonly ProgramAuthoringUploadToken[]>;
  applyMilestoneEdit(input: ApplyProgramMilestoneEditInput): Promise<void>;
}
