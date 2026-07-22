import type {
  AccountStatus,
  MilestoneSubmissionType,
  ProgramCategory,
  Role,
} from '@prisma/client';

export type ProgramAuthority = {
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
};

export type ProgramMilestoneView = {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
  readonly instructions: string | null;
};

export type EditableProgramView = {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationCount: number;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
  readonly repositoryProvisioningEnabled: boolean;
  readonly description: string;
  readonly milestones: readonly ProgramMilestoneView[];
};

export type ProgramSchedule = {
  readonly id: string;
  readonly applicationEndAt: Date;
};

export type ProgramMilestoneTarget = ProgramMilestoneView & {
  readonly programId: string;
  readonly applicationEndAt: Date;
};

export type ProgramMilestoneDeleteTarget = {
  readonly id: string;
  readonly programId: string;
  readonly submissionCount: number;
  readonly programMilestoneCount: number;
  readonly programRepositoryProvisioningEnabled: boolean;
};

export type ProgramUpdateInput = {
  readonly programId: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
  readonly repositoryProvisioningEnabled: boolean;
  readonly description: string;
};

export type ProgramMilestoneInput = {
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
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
}

export interface ProgramEditorRepositoryPort {
  withTransaction<T>(
    operation: (store: ProgramEditorTransactionStore) => Promise<T>,
  ): Promise<T>;
}
