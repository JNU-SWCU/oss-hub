import {
  ApiError,
  type ProblemDetail,
  type ProblemDetailFieldError,
} from '@/lib/api-client';
import { PROGRAM_EDIT_ERROR_CODES } from './program-edit-error-codes';
import type {
  EditableMilestone,
  EditableProgram,
  UpdateProgramInput,
  UpsertMilestoneInput,
} from './api';
import type { ProgramCategory } from './program-templates';
import type { SubmissionType } from './types';

export interface ProgramEditForm {
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly originalApplicationStartAt: string;
  readonly originalApplicationEndAt: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly description: string;
  readonly teamMinSize: string;
  readonly teamMaxSize: string;
}

export type ProgramEditableField = Exclude<
  keyof ProgramEditForm,
  'originalApplicationStartAt' | 'originalApplicationEndAt'
>;

export interface ProgramEditErrors {
  readonly name?: string;
  readonly organizer?: string;
  readonly category?: string;
  readonly period?: string;
  readonly team?: string;
  readonly description?: string;
  readonly general?: string;
}

export interface ProgramMilestoneForm {
  readonly id: string | null;
  readonly name: string;
  readonly dueAt: string;
  readonly originalDueAt: string | null;
  readonly submissionType: SubmissionType;
  readonly instructions: string;
}

export type ProgramMilestoneField = Exclude<
  keyof ProgramMilestoneForm,
  'id' | 'originalDueAt'
>;

export interface ProgramMilestoneErrors {
  readonly name?: string;
  readonly dueAt?: string;
  readonly instructions?: string;
  readonly general?: string;
}

export type ProgramMilestoneEditor =
  | { readonly mode: 'closed' }
  | {
      readonly mode: 'create' | 'edit';
      readonly form: ProgramMilestoneForm;
      readonly errors: ProgramMilestoneErrors;
    };

export { PROGRAM_EDIT_ERROR_CODES } from './program-edit-error-codes';

const DEFAULT_MILESTONE_TYPE = 'TEXT' satisfies SubmissionType;

export function toProgramEditForm(program: EditableProgram): ProgramEditForm {
  return {
    name: program.name,
    organizer: program.organizer,
    category: program.category,
    applicationStartAt: toDateTimeLocal(program.applicationStartAt),
    applicationEndAt: toDateTimeLocal(program.applicationEndAt),
    originalApplicationStartAt: program.applicationStartAt,
    originalApplicationEndAt: program.applicationEndAt,
    repositoryProvisioningEnabled: program.repositoryProvisioningEnabled,
    description: program.description,
    teamMinSize: program.teamMinSize?.toString() ?? '',
    teamMaxSize: program.teamMaxSize?.toString() ?? '',
  };
}

export function toMilestoneForm(
  milestone: EditableMilestone,
): ProgramMilestoneForm {
  return {
    id: milestone.id,
    name: milestone.name,
    dueAt: toDateTimeLocal(milestone.dueAt),
    originalDueAt: milestone.dueAt,
    submissionType: milestone.submissionType,
    instructions: milestone.instructions ?? '',
  };
}

export function emptyMilestoneForm(): ProgramMilestoneForm {
  return {
    id: null,
    name: '',
    dueAt: '',
    originalDueAt: null,
    submissionType: DEFAULT_MILESTONE_TYPE,
    instructions: '',
  };
}

export function buildProgramEditInput(
  form: ProgramEditForm,
  requiresTeam: boolean,
  dirtyFields: readonly ProgramEditableField[] = [
    'applicationStartAt',
    'applicationEndAt',
  ],
): UpdateProgramInput {
  return {
    name: form.name.trim(),
    organizer: form.organizer.trim(),
    category: form.category,
    applicationStartAt: dirtyFields.includes('applicationStartAt')
      ? toIsoString(form.applicationStartAt)
      : form.originalApplicationStartAt,
    applicationEndAt: dirtyFields.includes('applicationEndAt')
      ? toIsoString(form.applicationEndAt)
      : form.originalApplicationEndAt,
    repositoryProvisioningEnabled: form.repositoryProvisioningEnabled,
    description: form.description.trim(),
    teamMinSize: requiresTeam ? Number(form.teamMinSize) : null,
    teamMaxSize: requiresTeam ? Number(form.teamMaxSize) : null,
  };
}

export function buildMilestoneInput(
  form: ProgramMilestoneForm,
  dirtyFields: readonly ProgramMilestoneField[] = ['dueAt'],
): UpsertMilestoneInput {
  return {
    name: form.name.trim(),
    dueAt:
      dirtyFields.includes('dueAt') || form.originalDueAt === null
        ? toIsoString(form.dueAt)
        : form.originalDueAt,
    submissionType: form.submissionType,
    instructions: form.instructions.trim() || null,
  };
}

export function mapProgramEditError(error: unknown): ProgramEditErrors {
  if (!(error instanceof ApiError)) {
    return { general: '저장에 실패했습니다. 다시 시도해 주세요.' };
  }
  return mapProgramProblem(error.problem);
}

export function mapMilestoneError(error: unknown): ProgramMilestoneErrors {
  if (!(error instanceof ApiError)) {
    return { general: '마일스톤을 저장하지 못했습니다.' };
  }
  const fieldErrors = mapProblemFieldErrors(error.problem.fieldErrors);
  if (Object.keys(fieldErrors).length > 0) return fieldErrors;

  switch (error.problem.code) {
    case PROGRAM_EDIT_ERROR_CODES.MILESTONE_BEFORE_APPLICATION_END:
      return { dueAt: '마일스톤 마감은 신청 종료 이후여야 합니다.' };
    case PROGRAM_EDIT_ERROR_CODES.MILESTONE_REQUIRED:
      return {
        general: '팀 프로그램에는 최소 1개 이상의 마일스톤이 필요합니다.',
      };
    default:
      return { general: error.problem.detail };
  }
}

export function isMilestoneSubmissionConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.problem.code === PROGRAM_EDIT_ERROR_CODES.MILESTONE_HAS_SUBMISSIONS
  );
}

function mapProgramProblem(problem: ProblemDetail): ProgramEditErrors {
  const fieldErrors = mapProblemFieldErrors(problem.fieldErrors);
  if (Object.keys(fieldErrors).length > 0) return fieldErrors;

  switch (problem.code) {
    case PROGRAM_EDIT_ERROR_CODES.CATEGORY_LOCKED_BY_APPLICATIONS:
      return {
        category: '신청자가 있는 프로그램은 유형을 변경할 수 없습니다.',
      };
    case PROGRAM_EDIT_ERROR_CODES.INVALID_APPLICATION_PERIOD:
      return { period: '신청 기간을 확인해 주세요.' };
    case PROGRAM_EDIT_ERROR_CODES.VALIDATION_ERROR:
      return { general: '입력값을 확인해 주세요.' };
    default:
      return { general: problem.detail };
  }
}

function mapProblemFieldErrors(
  fieldErrors: readonly ProblemDetailFieldError[] | undefined,
): ProgramEditErrors & ProgramMilestoneErrors {
  const errors: {
    name?: string;
    organizer?: string;
    category?: string;
    period?: string;
    team?: string;
    description?: string;
    dueAt?: string;
    instructions?: string;
  } = {};
  for (const fieldError of fieldErrors ?? []) {
    switch (fieldError.field) {
      case 'name':
        errors.name = fieldError.message;
        break;
      case 'organizer':
        errors.organizer = fieldError.message;
        break;
      case 'category':
        errors.category = fieldError.message;
        break;
      case 'applicationStartAt':
      case 'applicationEndAt':
        errors.period = fieldError.message;
        break;
      case 'teamMinSize':
      case 'teamMaxSize':
        errors.team = fieldError.message;
        break;
      case 'description':
        errors.description = fieldError.message;
        break;
      case 'dueAt':
        errors.dueAt = fieldError.message;
        break;
      case 'instructions':
        errors.instructions = fieldError.message;
        break;
    }
  }
  return errors;
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  const year = String(date.getFullYear());
  const month = twoDigits(date.getMonth() + 1);
  const day = twoDigits(date.getDate());
  const hour = twoDigits(date.getHours());
  const minute = twoDigits(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toIsoString(value: string): string {
  return new Date(value).toISOString();
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}
