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
import {
  isProgramEndAtUndecided,
  PROGRAM_END_AT_UNDECIDED,
} from './program-end-at';
import type { ProgramCategory } from './program-templates';
import type { SubmissionType } from './types';

export interface ProgramEditForm {
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly startAt: string;
  readonly originalStartAt: string;
  readonly endAt: string;
  /**
   * 종료일을 「미정」으로 둔다 — 켜져 있으면 `endAt` 입력은 비활성이고 저장 시
   * 센티널로 바뀐다(`program-end-at.ts`). 센티널을 들고 있는 기존 프로그램은
   * 편집 화면을 열 때 이 값이 켜진 채로 시작한다.
   */
  readonly endAtUndecided: boolean;
  readonly originalApplicationStartAt: string;
  readonly originalApplicationEndAt: string;
  readonly originalEndAt: string | null;
  readonly milestoneDueAts: readonly string[];
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
  readonly description: string;
  readonly teamMinSize: string;
  readonly teamMaxSize: string;
}

export type ProgramEditableField = Exclude<
  keyof ProgramEditForm,
  | 'originalApplicationStartAt'
  | 'originalApplicationEndAt'
  | 'originalStartAt'
  | 'originalEndAt'
  | 'milestoneDueAts'
>;

export interface ProgramEditErrors {
  readonly name?: string;
  readonly organizer?: string;
  readonly category?: string;
  readonly period?: string;
  readonly startAt?: string;
  readonly endAt?: string;
  readonly team?: string;
  readonly description?: string;
  readonly general?: string;
}

export interface ProgramMilestoneForm {
  readonly id: string | null;
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly originalStartAt: string | null;
  readonly originalDueAt: string | null;
  readonly submissionType: SubmissionType;
  readonly instructions: string;
}

export type ProgramMilestoneField = Exclude<
  keyof ProgramMilestoneForm,
  'id' | 'originalStartAt' | 'originalDueAt'
>;

export interface ProgramMilestoneErrors {
  readonly name?: string;
  readonly startAt?: string;
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
class ProgramEditValidationError extends Error {
  constructor(readonly errors: ProgramEditErrors) {
    super('Program edit validation failed');
  }
}

export function toProgramEditForm(program: EditableProgram): ProgramEditForm {
  /**
   * 센티널은 폼 모델에 들어오기 전에 「미정」으로 갈린다 — 그 값을
   * `toDateTimeLocal` 에 넘기면 KST 에서 연도가 `10000` 이 되고, 그 문자열은
   * 되돌릴 수 없다(#826). 날짜 칸은 비워 두고 체크박스가 뜻을 나른다.
   */
  const endAtUndecided = isProgramEndAtUndecided(program.endAt);
  return {
    name: program.name,
    organizer: program.organizer,
    category: program.category,
    applicationStartAt: toDateTimeLocal(program.applicationStartAt),
    applicationEndAt: toDateTimeLocal(program.applicationEndAt),
    startAt: toDateTimeLocal(program.startAt ?? program.applicationEndAt),
    originalStartAt: program.startAt ?? program.applicationEndAt,
    endAt: endAtUndecided ? '' : toDateTimeLocal(program.endAt as string),
    endAtUndecided,
    originalApplicationStartAt: program.applicationStartAt,
    originalApplicationEndAt: program.applicationEndAt,
    originalEndAt: program.endAt,
    milestoneDueAts: program.milestones.map((milestone) => milestone.dueAt),
    repositoryProvisioningEnabled: program.repositoryProvisioningEnabled,
    notifyOnDeadline: program.notifyOnDeadline,
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
    startAt: toDateTimeLocal(milestone.startAt),
    dueAt: toDateTimeLocal(milestone.dueAt),
    originalStartAt: milestone.startAt,
    originalDueAt: milestone.dueAt,
    submissionType: milestone.submissionType,
    instructions: milestone.instructions ?? '',
  };
}

export function emptyMilestoneForm(): ProgramMilestoneForm {
  return {
    id: null,
    name: '',
    startAt: '',
    dueAt: '',
    originalStartAt: null,
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
  const applicationEndAt = dirtyFields.includes('applicationEndAt')
    ? toIsoString(form.applicationEndAt)
    : form.originalApplicationEndAt;
  const startAt = dirtyFields.includes('startAt')
    ? toIsoString(form.startAt)
    : form.originalStartAt;
  /**
   * 「미정」이면 날짜 칸을 보지 않고 센티널로 되돌린다 — 폼에서 비어 있는 것과
   * 「미정」은 다른 뜻이다. 비어 있는 것은 아직 고르지 않은 상태이고, 아래 분기가
   * 그것을 막는다.
   */
  const endAt = form.endAtUndecided
    ? PROGRAM_END_AT_UNDECIDED
    : form.endAt === ''
      ? null
      : dirtyFields.includes('endAt') || form.originalEndAt === null
        ? toIsoString(form.endAt)
        : form.originalEndAt;

  if (form.originalEndAt !== null && endAt === null) {
    throw new ProgramEditValidationError({
      endAt: '종료일을 정하거나 「종료일 미정」을 선택해 주세요.',
    });
  }
  if (
    endAt !== null &&
    (endAt <= applicationEndAt ||
      form.milestoneDueAts.some((dueAt) => endAt <= dueAt))
  ) {
    throw new ProgramEditValidationError({
      endAt:
        '프로그램 종료일은 신청 종료일과 모든 마일스톤 마감 이후여야 합니다.',
    });
  }

  return {
    name: form.name.trim(),
    organizer: form.organizer.trim(),
    category: form.category,
    applicationStartAt: dirtyFields.includes('applicationStartAt')
      ? toIsoString(form.applicationStartAt)
      : form.originalApplicationStartAt,
    applicationEndAt,
    startAt,
    endAt,
    repositoryProvisioningEnabled: form.repositoryProvisioningEnabled,
    notifyOnDeadline: form.notifyOnDeadline,
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
    startAt:
      dirtyFields.includes('startAt') || form.originalStartAt === null
        ? toIsoString(form.startAt)
        : form.originalStartAt,
    dueAt:
      dirtyFields.includes('dueAt') || form.originalDueAt === null
        ? toIsoString(form.dueAt)
        : form.originalDueAt,
    submissionType: form.submissionType,
    instructions: form.instructions.trim() || null,
  };
}

export function mapProgramEditError(error: unknown): ProgramEditErrors {
  if (error instanceof ProgramEditValidationError) return error.errors;
  if (!(error instanceof ApiError)) {
    return { general: '저장에 실패했습니다. 다시 시도해 주세요.' };
  }
  return mapProgramProblem(error.problem);
}

/**
 * 저장 실패는 편집기를 열어 둔 채 errors만 채우므로(program-edit-page의 catch가
 * milestoneEditor의 form을 유지한다) 입력이 남아 있다고 단언할 수 있다.
 */
export const MILESTONE_SAVE_FAILED_MESSAGE =
  '마일스톤을 저장하지 못했습니다. 입력한 내용은 그대로 남아 있으니 잠시 후 다시 저장해 주세요.';

/** 삭제는 서버 상태가 갈릴 수 있어 남은 내용을 단언하지 않고 확인을 먼저 권한다. */
export const MILESTONE_DELETE_FAILED_MESSAGE =
  '마일스톤을 삭제하지 못했습니다. 목록을 새로고침해 현재 상태를 확인한 뒤 다시 시도해 주세요.';

/**
 * PRG_010의 실제 서버 규칙은 "저장소 자동 생성이 켜진 프로그램의 마일스톤 0개 금지"다
 * (program-editor.service의 updateProgram·deleteMilestone 검사).
 * 팀 여부와는 무관하므로 화면에서는 켜 둔 설정과 해야 할 일을 그대로 짚는다.
 */
export const MILESTONE_REQUIRED_ON_SAVE_MESSAGE =
  '저장소 자동 생성을 켜려면 마일스톤이 1개 이상 있어야 합니다. 마일스톤을 추가한 뒤 다시 저장해 주세요.';

export const MILESTONE_REQUIRED_ON_DELETE_MESSAGE =
  '저장소 자동 생성이 켜져 있어 마지막 마일스톤은 삭제할 수 없습니다. 다른 마일스톤을 먼저 추가하거나 저장소 자동 생성을 꺼 주세요.';

export function mapMilestoneError(error: unknown): ProgramMilestoneErrors {
  if (!(error instanceof ApiError)) {
    return { general: MILESTONE_SAVE_FAILED_MESSAGE };
  }
  const fieldErrors = mapProblemFieldErrors(error.problem.fieldErrors);
  if (Object.keys(fieldErrors).length > 0) return fieldErrors;

  switch (error.problem.code) {
    case PROGRAM_EDIT_ERROR_CODES.MILESTONE_BEFORE_APPLICATION_END:
      return { dueAt: '마일스톤 마감은 신청 종료 이후여야 합니다.' };
    case PROGRAM_EDIT_ERROR_CODES.MILESTONE_REQUIRED:
      return { general: MILESTONE_REQUIRED_ON_SAVE_MESSAGE };
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

/** 삭제 실패 문구를 한 곳에 모은다. 화면은 이 결과를 그대로 알림에 넣는다. */
export function mapMilestoneDeleteError(error: unknown): string {
  if (isMilestoneSubmissionConflict(error)) {
    return '제출물이 있는 마일스톤은 삭제할 수 없습니다.';
  }
  if (
    error instanceof ApiError &&
    error.problem.code === PROGRAM_EDIT_ERROR_CODES.MILESTONE_REQUIRED
  ) {
    return MILESTONE_REQUIRED_ON_DELETE_MESSAGE;
  }
  return MILESTONE_DELETE_FAILED_MESSAGE;
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
    case PROGRAM_EDIT_ERROR_CODES.MILESTONE_REQUIRED:
      return { general: MILESTONE_REQUIRED_ON_SAVE_MESSAGE };
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
    startAt?: string;
    team?: string;
    description?: string;
    endAt?: string;
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
      case 'startAt':
        errors.startAt = fieldError.message;
        break;
      case 'endAt':
        errors.endAt = fieldError.message;
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
