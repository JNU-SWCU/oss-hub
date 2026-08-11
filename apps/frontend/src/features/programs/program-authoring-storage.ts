import {
  PROGRAM_AUTHORING_STEPS,
  type ProgramAuthoringMilestone,
  type ProgramAuthoringRequirement,
  type ProgramAuthoringState,
  type ProgramAuthoringStep,
} from './program-authoring-model';
import { PROGRAM_CATEGORIES, type ProgramCategory } from './program-templates';
import type { SubmissionType } from './types';

export const PROGRAM_AUTHORING_STORAGE_KEY = 'oss-hub:program-authoring';
export const PROGRAM_AUTHORING_STORAGE_VERSION = 3;

export interface ProgramAuthoringStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

export function serializeProgramAuthoringState(
  state: ProgramAuthoringState,
): string {
  return JSON.stringify({ version: PROGRAM_AUTHORING_STORAGE_VERSION, state });
}

export function persistProgramAuthoringState(
  storage: ProgramAuthoringStorage,
  state: ProgramAuthoringState,
): void {
  storage.setItem(
    PROGRAM_AUTHORING_STORAGE_KEY,
    serializeProgramAuthoringState(state),
  );
}

export function clearProgramAuthoringState(
  storage: ProgramAuthoringStorage,
): void {
  storage.removeItem(PROGRAM_AUTHORING_STORAGE_KEY);
}

export function loadProgramAuthoringState(
  storage: ProgramAuthoringStorage,
): ProgramAuthoringState | null {
  const raw = storage.getItem(PROGRAM_AUTHORING_STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== PROGRAM_AUTHORING_STORAGE_VERSION
    ) {
      storage.removeItem(PROGRAM_AUTHORING_STORAGE_KEY);
      return null;
    }
    const migrated = migrateLegacyRequirementsStep(parsed.state);
    if (!isProgramAuthoringState(migrated)) {
      storage.removeItem(PROGRAM_AUTHORING_STORAGE_KEY);
      return null;
    }
    return markFilesForReselection(migrated);
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
    storage.removeItem(PROGRAM_AUTHORING_STORAGE_KEY);
    return null;
  }
}

// '요구서류/양식' 스텝이 마일스톤 스텝으로 흡수되며 사라진 이후에도,
// 예전 세션이 남긴 currentStep: 'requirements'를 유효한 스텝으로 되돌려
// 전체 상태를 폐기하지 않고 이어서 작성할 수 있게 한다.
function migrateLegacyRequirementsStep(value: unknown): unknown {
  if (!isRecord(value) || value.currentStep !== 'requirements') return value;
  return { ...value, currentStep: 'milestones' };
}

function markFilesForReselection(
  state: ProgramAuthoringState,
): ProgramAuthoringState {
  return {
    ...state,
    milestones: state.milestones.map((milestone) => ({
      ...milestone,
      requirements: milestone.requirements.map((requirement) => ({
        ...requirement,
        templateFile:
          requirement.templateFile === null
            ? null
            : { ...requirement.templateFile, requiresReselection: true },
      })),
    })),
  };
}

function isProgramAuthoringState(
  value: unknown,
): value is ProgramAuthoringState {
  if (!isRecord(value)) return false;
  return (
    isStep(value.currentStep) &&
    isString(value.idempotencyKey) &&
    isCategory(value.category) &&
    typeof value.repositoryProvisioningEnabled === 'boolean' &&
    typeof value.notifyOnDeadline === 'boolean' &&
    PROGRAM_TEXT_FIELDS.every((field) => isString(value[field])) &&
    Array.isArray(value.milestones) &&
    value.milestones.every(isMilestone)
  );
}

const PROGRAM_TEXT_FIELDS = [
  'name',
  'organizer',
  'description',
  'applicationStartAt',
  'applicationEndAt',
  'operationStartAt',
  'operationEndAt',
  'teamMinSize',
  'teamMaxSize',
] as const;

function isMilestone(value: unknown): value is ProgramAuthoringMilestone {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.name) &&
    isString(value.startAt) &&
    isString(value.dueAt) &&
    isSubmissionType(value.submissionType) &&
    isString(value.instructions) &&
    Array.isArray(value.requirements) &&
    value.requirements.every(isRequirement)
  );
}

function isRequirement(value: unknown): value is ProgramAuthoringRequirement {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.name) &&
    typeof value.required === 'boolean' &&
    isSubmissionType(value.submissionType) &&
    (value.templateFile === null || isTemplateFile(value.templateFile))
  );
}

function isTemplateFile(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.name) &&
    typeof value.size === 'number' &&
    isString(value.type) &&
    typeof value.requiresReselection === 'boolean'
  );
}

function isStep(value: unknown): value is ProgramAuthoringStep {
  return (
    typeof value === 'string' &&
    PROGRAM_AUTHORING_STEPS.some((step) => step.id === value)
  );
}

function isCategory(value: unknown): value is ProgramCategory {
  return (
    typeof value === 'string' &&
    PROGRAM_CATEGORIES.some((category) => category === value)
  );
}

function isSubmissionType(value: unknown): value is SubmissionType {
  return value === 'FILE' || value === 'TEXT';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
