import type {
  AccountStatus,
  MilestoneSubmissionType,
  ProgramCategory,
  ProgramLifecycle,
  RoleRequestStatus,
  Role,
} from '@prisma/client';

export type ProgramAuthority = {
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
  readonly roleRequests: readonly { readonly status: RoleRequestStatus }[];
};

export type ProgramMilestoneView = {
  readonly id: string;
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
  readonly instructions: string | null;
};

export type ProgramCategoryLockState = {
  readonly locked: boolean;
  readonly byApplications: boolean;
  readonly byTeams: boolean;
  readonly applicationCount: number;
  readonly teamCount: number;
};

export type EditableProgramView = {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly lifecycle?: ProgramLifecycle;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationCount: number;
  readonly teamCount: number;
  readonly categoryLocked: ProgramCategoryLockState;
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

export type ProgramMilestoneTarget = ProgramMilestoneView & {
  readonly programId: string;
  readonly programStartAt: Date;
  readonly endAt: Date;
};

export type ProgramMilestoneDeleteTarget = {
  readonly id: string;
  readonly programId: string;
  readonly submissionCount: number;
  /**
   * 이 마일스톤의 서류 항목(MilestoneDocument)들에 달린 제출 수. 기존 submissionCount와
   * 따로 세는 이유는 두 제출 경로가 다른 테이블이기 때문이다 — 거부 여부는 같은 뜻이라
   * 서비스 계층이 둘 다 MILESTONE_HAS_SUBMISSIONS로 묶는다.
   */
  readonly documentSubmissionCount: number;
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
