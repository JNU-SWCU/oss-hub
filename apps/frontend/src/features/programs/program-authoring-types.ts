import type { ProgramCategory } from './program-templates';

export const PROGRAM_AUTHORING_STEPS = [
  { id: 'type', label: '유형' },
  { id: 'basic', label: '기본 정보' },
  { id: 'schedule', label: '신청/운영 일정' },
  { id: 'milestones', label: '마일스톤' },
  { id: 'operations', label: '운영 설정' },
  { id: 'review', label: '최종 검토' },
] as const;

export type ProgramAuthoringStep =
  (typeof PROGRAM_AUTHORING_STEPS)[number]['id'];

export type ProgramAuthoringTemplateFile = {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly requiresReselection: boolean;
};

export type ProgramAuthoringRequirement = {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly templateFile: ProgramAuthoringTemplateFile | null;
};

export type ProgramAuthoringMilestone = {
  readonly id: string;
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly instructions: string;
  readonly requirements: readonly ProgramAuthoringRequirement[];
};

export type ProgramAuthoringState = {
  readonly currentStep: ProgramAuthoringStep;
  readonly idempotencyKey: string;
  readonly category: ProgramCategory;
  readonly name: string;
  readonly organizer: string;
  readonly description: string;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly operationStartAt: string;
  readonly operationEndAt: string;
  readonly teamMinSize: string;
  readonly teamMaxSize: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
  readonly milestones: readonly ProgramAuthoringMilestone[];
};

type ProgramTextField = Exclude<
  keyof ProgramAuthoringState,
  | 'currentStep'
  | 'idempotencyKey'
  | 'category'
  | 'repositoryProvisioningEnabled'
  | 'notifyOnDeadline'
  | 'milestones'
>;

type MilestoneTextField = 'name' | 'startAt' | 'dueAt' | 'instructions';

export type ProgramAuthoringAction =
  | {
      readonly type: 'restore_state';
      readonly state: ProgramAuthoringState;
    }
  | { readonly type: 'go_to_step'; readonly step: ProgramAuthoringStep }
  | { readonly type: 'set_category'; readonly category: ProgramCategory }
  | {
      readonly type: 'set_repository_provisioning_enabled';
      readonly enabled: boolean;
    }
  | { readonly type: 'set_notify_on_deadline'; readonly enabled: boolean }
  | {
      readonly type: 'set_program_field';
      readonly field: ProgramTextField;
      readonly value: string;
    }
  | { readonly type: 'add_milestone'; readonly milestoneId: string }
  | { readonly type: 'remove_milestone'; readonly milestoneId: string }
  | {
      readonly type: 'set_milestone_field';
      readonly milestoneId: string;
      readonly field: MilestoneTextField;
      readonly value: string;
    }
  | {
      readonly type: 'add_requirement';
      readonly milestoneId: string;
      readonly requirementId: string;
    }
  | {
      readonly type: 'remove_requirement';
      readonly milestoneId: string;
      readonly requirementId: string;
    }
  | {
      readonly type: 'set_requirement_name';
      readonly milestoneId: string;
      readonly requirementId: string;
      readonly name: string;
    }
  | {
      readonly type: 'set_requirement_required';
      readonly milestoneId: string;
      readonly requirementId: string;
      readonly required: boolean;
    }
  | {
      readonly type: 'set_requirement_file';
      readonly milestoneId: string;
      readonly requirementId: string;
      readonly file: Omit<
        ProgramAuthoringTemplateFile,
        'requiresReselection'
      > | null;
    }
  | { readonly type: 'rotate_idempotency_key'; readonly key: string };
