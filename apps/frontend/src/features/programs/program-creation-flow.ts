import type { CreateProgramInput, CreatedProgram } from './api';
import type { ProgramTemplateDefinition } from './program-templates';

export interface ProgramForm {
  readonly name: string;
  readonly organizer: string;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly teamMinSize: string;
  readonly teamMaxSize: string;
  readonly description: string;
}

export const EMPTY_PROGRAM_FORM: ProgramForm = {
  name: '',
  organizer: '',
  applicationStartAt: '',
  applicationEndAt: '',
  teamMinSize: '',
  teamMaxSize: '',
  description: '',
};

export interface ProgramFormErrors {
  readonly name?: string;
  readonly organizer?: string;
  readonly period?: string;
  readonly team?: string;
  readonly description?: string;
}

export const UNSAVED_PROGRAM_MESSAGE =
  '저장하지 않은 입력이 있습니다. 이 페이지를 나가시겠습니까?';

/** Mutable by design: one in-flight creation request owns the lock. */
export interface ProgramSubmissionLock {
  current: boolean;
}

export function validateProgramForm(
  form: ProgramForm,
  template: ProgramTemplateDefinition,
): ProgramFormErrors {
  const errors: {
    name?: string;
    organizer?: string;
    period?: string;
    team?: string;
    description?: string;
  } = {};
  if (!form.name.trim()) errors.name = '프로그램명을 입력해 주세요.';
  if (!form.organizer.trim()) errors.organizer = '주관기관을 입력해 주세요.';
  if (
    !form.applicationStartAt ||
    !form.applicationEndAt ||
    new Date(form.applicationEndAt) < new Date(form.applicationStartAt)
  )
    errors.period = '올바른 신청 기간을 입력해 주세요.';
  if (
    template.template.participation === 'team' &&
    (!Number.isInteger(Number(form.teamMinSize)) ||
      !Number.isInteger(Number(form.teamMaxSize)) ||
      Number(form.teamMinSize) < 1 ||
      Number(form.teamMinSize) > Number(form.teamMaxSize))
  )
    errors.team = '팀 인원 범위를 확인해 주세요.';
  if (!form.description.trim())
    errors.description = '소개/설명을 입력해 주세요.';
  return errors;
}

export function hasProgramFormInput(form: ProgramForm): boolean {
  return [
    form.name,
    form.organizer,
    form.applicationStartAt,
    form.applicationEndAt,
    form.teamMinSize,
    form.teamMaxSize,
    form.description,
  ].some((value) => value.trim().length > 0);
}

export function buildCreateProgramInput(
  form: ProgramForm,
  template: ProgramTemplateDefinition,
): CreateProgramInput {
  const isTeam = template.template.participation === 'team';
  return {
    name: form.name.trim(),
    organizer: form.organizer.trim(),
    category: template.category,
    applicationStartAt: new Date(form.applicationStartAt).toISOString(),
    applicationEndAt: new Date(form.applicationEndAt).toISOString(),
    teamMinSize: isTeam ? Number(form.teamMinSize) : null,
    teamMaxSize: isTeam ? Number(form.teamMaxSize) : null,
    description: form.description.trim(),
  };
}

export type ProgramSubmissionStart =
  | { readonly status: 'ignored' }
  | { readonly status: 'started'; readonly completion: Promise<void> };

export function startProgramSubmission(
  lock: ProgramSubmissionLock,
  input: CreateProgramInput,
  create: (input: CreateProgramInput) => Promise<CreatedProgram>,
  navigate: (path: string) => void,
): ProgramSubmissionStart {
  if (lock.current) return { status: 'ignored' };
  lock.current = true;
  try {
    const completion = create(input)
      .then((program) => navigate(program.detailUrl))
      .finally(() => {
        lock.current = false;
      });
    return { status: 'started', completion };
  } catch (error) {
    lock.current = false;
    throw error;
  }
}
