import type {
  AccountStatus,
  MilestoneSubmissionType,
  ProgramLifecycle,
  ProgramTrackType,
  StaffAccessRequestStatus,
} from '@prisma/client';
import type { ProgramDeletionScopeCounts } from './program-deletion-scope';

export type { ProgramDeletionScopeCounts } from './program-deletion-scope';

export type ProgramAuthority = {
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
  readonly trackType: ProgramTrackType | null;
  readonly lifecycle?: ProgramLifecycle;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationCount: number;
  readonly teamCount: number;
  /** 전체 삭제 확인 전 다시 읽는, 프로그램에 직접 연결된 4종 자식 수. */
  readonly deletionScopeCounts?: ProgramDeletionScopeCounts;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly startAt: Date;
  readonly endAt: string;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
  /** true면 위험 영역의 삭제·전체 삭제가 서비스 계층에서 무조건 거부된다(F2 finding #1). */
  readonly deletionProtected: boolean;
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
  /** 이 마일스톤의 내부 제출 슬롯과 일반 서류 항목에 달린 target 제출 수. */
  readonly documentSubmissionCount: number;
  readonly programMilestoneCount: number;
  readonly programRepositoryProvisioningEnabled: boolean;
};

export type ProgramUpdateInput = {
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
}

export interface ProgramEditorRepositoryPort {
  withTransaction<T>(
    operation: (store: ProgramEditorTransactionStore) => Promise<T>,
  ): Promise<T>;
}
