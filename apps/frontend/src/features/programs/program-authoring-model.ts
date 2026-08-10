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
    submissionType: 'FILE',
    templateFile: null,
  };
}

export function createMilestoneDraft(id: string): ProgramAuthoringMilestone {
  return {
    id,
    name: '',
    startAt: '',
    dueAt: '',
    submissionType: 'TEXT',
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
    notifyOnDeadline: false,
    milestones: [createMilestoneDraft(input.milestoneId)],
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
    case 'set_milestone_field':
      return mapMilestone(state, action.milestoneId, (milestone) => ({
        ...milestone,
        [action.field]: action.value,
      }));
    case 'set_milestone_type':
      return mapMilestone(state, action.milestoneId, (milestone) => ({
        ...milestone,
        submissionType: action.submissionType,
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
      return mapRequirement(state, action, () => null);
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
    case 'set_requirement_type':
      return mapRequirement(state, action, (requirement) => ({
        ...requirement,
        submissionType: action.submissionType,
        templateFile:
          action.submissionType === 'TEXT' ? null : requirement.templateFile,
      }));
    case 'set_requirement_file':
      return mapRequirement(state, action, (requirement) => ({
        ...requirement,
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

function assertNever(value: never): never {
  throw new TypeError(`Unhandled program authoring action: ${String(value)}`);
}
