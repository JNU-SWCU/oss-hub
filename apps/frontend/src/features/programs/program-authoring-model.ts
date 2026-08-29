import type {
  ProgramAuthoringAction,
  ProgramAuthoringMilestone,
  ProgramAuthoringRequirement,
  ProgramAuthoringState,
} from './program-authoring-types';

export { PROGRAM_AUTHORING_STEPS } from './program-authoring-types';
export type {
  ProgramAuthoringAction,
  ProgramAuthoringMilestone,
  ProgramAuthoringRequirement,
  ProgramAuthoringState,
  ProgramAuthoringStep,
  ProgramAuthoringTemplateFile,
} from './program-authoring-types';

export function createRequirementDraft(
  id: string,
): ProgramAuthoringRequirement {
  return {
    id,
    name: '',
    required: true,
    templateFile: null,
  };
}

export function createMilestoneDraft(id: string): ProgramAuthoringMilestone {
  return {
    id,
    name: '',
    startAt: '',
    dueAt: '',
    instructions: '',
    requirements: [],
  };
}

export function createInitialProgramAuthoringState(input: {
  readonly idempotencyKey: string;
  readonly milestoneId: string;
}): ProgramAuthoringState {
  return {
    currentStep: 'type',
    idempotencyKey: input.idempotencyKey,
    category: 'BASIC',
    name: '',
    organizer: '',
    description: '',
    applicationStartAt: '',
    applicationEndAt: '',
    operationStartAt: '',
    operationEndAt: '',
    teamMinSize: '1',
    teamMaxSize: '1',
    repositoryProvisioningEnabled: false,
    /**
     * 새 프로그램은 마감 알림을 켜고 시작한다. `Program.notifyOnDeadline` 의 DB
     * 기본값은 `false` 라서(`prisma/schema.prisma`) 그 값을 그대로 물려받으면
     * 교직원이 켠 적 없다는 사실조차 모른 채 미제출 알림이 한 통도 나가지 않는다.
     * 알림을 안 받겠다는 선택은 화면에서 체크를 풀어 명시적으로 한다.
     */
    notifyOnDeadline: true,
    milestones: [],
  };
}

export function programAuthoringReducer(
  state: ProgramAuthoringState,
  action: ProgramAuthoringAction,
): ProgramAuthoringState {
  switch (action.type) {
    case 'restore_state':
      return action.state;
    case 'go_to_step':
      return { ...state, currentStep: action.step };
    case 'set_category':
      return { ...state, category: action.category };
    case 'set_repository_provisioning_enabled':
      return { ...state, repositoryProvisioningEnabled: action.enabled };
    case 'set_notify_on_deadline':
      return { ...state, notifyOnDeadline: action.enabled };
    case 'set_program_field':
      return { ...state, [action.field]: action.value };
    case 'add_milestone':
      return {
        ...state,
        milestones: [
          ...state.milestones,
          createMilestoneDraft(action.milestoneId),
        ],
      };
    case 'remove_milestone':
      return {
        ...state,
        milestones: state.milestones.filter(
          (milestone) => milestone.id !== action.milestoneId,
        ),
      };
    case 'replace_milestone':
      return mapMilestone(state, action.milestone.id, () => action.milestone);
    case 'set_milestone_field':
      return mapMilestone(state, action.milestoneId, (milestone) => ({
        ...milestone,
        [action.field]: action.value,
      }));
    case 'add_requirement':
      return mapMilestone(state, action.milestoneId, (milestone) => ({
        ...milestone,
        requirements: [
          ...milestone.requirements,
          createRequirementDraft(action.requirementId),
        ],
      }));
    case 'remove_requirement':
      return mapMilestone(state, action.milestoneId, (milestone) => ({
        ...milestone,
        requirements: milestone.requirements.filter(
          (requirement) => requirement.id !== action.requirementId,
        ),
      }));
    case 'reorder_requirements':
      return reorderRequirements(state, action);
    case 'set_requirement_name':
      return mapRequirement(state, action, (requirement) => ({
        ...requirement,
        name: action.name,
      }));
    case 'set_requirement_required':
      return mapRequirement(state, action, (requirement) => ({
        ...requirement,
        required: action.required,
      }));
    case 'set_requirement_file':
      return mapRequirement(state, action, (requirement) => ({
        ...requirement,
        name:
          action.file !== null && requirement.name.trim() === ''
            ? action.file.name
            : requirement.name,
        templateFile:
          action.file === null
            ? null
            : { ...action.file, requiresReselection: false },
      }));
    case 'rotate_idempotency_key':
      return { ...state, idempotencyKey: action.key };
    default:
      return assertNever(action);
  }
}

function mapMilestone(
  state: ProgramAuthoringState,
  milestoneId: string,
  update: (milestone: ProgramAuthoringMilestone) => ProgramAuthoringMilestone,
): ProgramAuthoringState {
  return {
    ...state,
    milestones: state.milestones.map((milestone) =>
      milestone.id === milestoneId ? update(milestone) : milestone,
    ),
  };
}

type RequirementAction = Extract<
  ProgramAuthoringAction,
  { readonly milestoneId: string; readonly requirementId: string }
>;

type ReorderRequirementsAction = Extract<
  ProgramAuthoringAction,
  { readonly type: 'reorder_requirements' }
>;

function mapRequirement(
  state: ProgramAuthoringState,
  action: RequirementAction,
  update: (
    requirement: ProgramAuthoringRequirement,
  ) => ProgramAuthoringRequirement | null,
): ProgramAuthoringState {
  return mapMilestone(state, action.milestoneId, (milestone) => ({
    ...milestone,
    requirements: milestone.requirements.flatMap((requirement) => {
      if (requirement.id !== action.requirementId) return [requirement];
      const next = update(requirement);
      return next === null ? [] : [next];
    }),
  }));
}

function reorderRequirements(
  state: ProgramAuthoringState,
  action: ReorderRequirementsAction,
): ProgramAuthoringState {
  const milestone = state.milestones.find(
    (candidate) => candidate.id === action.milestoneId,
  );
  if (!milestone) return state;

  const requirementsById = new Map(
    milestone.requirements.map((requirement) => [requirement.id, requirement]),
  );
  if (
    action.requirementIds.length !== milestone.requirements.length ||
    new Set(action.requirementIds).size !== action.requirementIds.length ||
    action.requirementIds.some((id) => !requirementsById.has(id))
  ) {
    return state;
  }

  return mapMilestone(state, action.milestoneId, (candidate) => ({
    ...candidate,
    requirements: action.requirementIds.map((id) => requirementsById.get(id)!),
  }));
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled program authoring action: ${String(value)}`);
}
