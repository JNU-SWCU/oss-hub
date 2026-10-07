import type { ProblemDetail, ProblemDetailFieldError } from '@/lib/api-client';
import type { ProgramTeam } from './api';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

export type ProgramApplyBlockedReason =
  'period-closed' | 'already-applied' | 'team-required' | 'manage-not-allowed';

export type ProgramApplyReadyState = {
  readonly kind: 'ready';
  readonly program: ProgramDetail;
  readonly template: ApplicationFormTemplate;
  readonly applicantName: string;
  readonly teamId: string | null;
  readonly teamMinimum: TeamMinimum | null;
};

export type TeamMinimum = {
  readonly memberCount: number;
  readonly teamMinSize: number;
};

export function resolveTeamMinimum(
  team: Pick<ProgramTeam, 'memberCount' | 'minMembers'>,
): TeamMinimum | null {
  if (team.minMembers === null) return null;
  return { memberCount: team.memberCount, teamMinSize: team.minMembers };
}

export function remainingTeamMembers(teamMinimum: TeamMinimum | null): number {
  if (teamMinimum === null) return 0;
  return Math.max(teamMinimum.teamMinSize - teamMinimum.memberCount, 0);
}

export type ProgramApplyPageState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly message: string }
  | {
      readonly kind: 'blocked';
      readonly reason: ProgramApplyBlockedReason;
      readonly program: ProgramDetail;
    }
  | ProgramApplyReadyState
  | {
      readonly kind: 'success';
      readonly program: ProgramDetail;
      readonly applicationId: string;
    };

export type ProgramApplyFormValues = {
  readonly title?: string;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly personalDataConsent: boolean;
};

export type ProgramApplyFormErrors = {
  readonly title?: string;
  readonly repositoryUrl?: string;
  readonly personalDataConsent?: string;
};

export const EMPTY_APPLY_FORM: ProgramApplyFormValues = {
  isRepositoryPublicationPlanned: true,
  personalDataConsent: false,
};

export function isApplicationPeriodOpen(
  program: ProgramDetail,
  now: number = Date.now(),
): boolean {
  const startsAt = new Date(program.applicationPeriod.startsAt).getTime();
  const endsAt = new Date(program.applicationPeriod.endsAt).getTime();
  return startsAt <= now && now <= endsAt;
}

export function resolveApplyBlockedReason(
  program: ProgramDetail,
  _template: ApplicationFormTemplate,
  _teamId: string | null,
  now: number = Date.now(),
): ProgramApplyBlockedReason | null {
  if (!isApplicationPeriodOpen(program, now)) return 'period-closed';
  if (program.viewer.applicationStatus !== null) return 'already-applied';
  return null;
}

export function validateApplyForm(
  values: ProgramApplyFormValues,
  mode: 'create' | 'edit' = 'create',
): ProgramApplyFormErrors {
  return {
    ...(mode === 'create' && !values.personalDataConsent
      ? {
          personalDataConsent:
            '개인정보 수집·이용에 동의해야 지원할 수 있습니다.',
        }
      : {}),
  };
}

export type ProgramApplyAction = 'submit' | 'save' | 'cancel';

export function applyActionFailureMessage(action: ProgramApplyAction): string {
  switch (action) {
    case 'save':
      return '신청서를 저장하지 못했습니다. 입력한 내용은 그대로 남아 있으니 잠시 후 다시 저장해 주세요.';
    case 'cancel':
      return '신청을 취소하지 못했습니다. 페이지를 새로고침해 현재 신청 상태를 확인한 뒤 다시 시도해 주세요.';
    case 'submit':
      return '신청서를 제출하지 못했습니다. 입력한 내용은 그대로 남아 있으니 잠시 후 다시 제출해 주세요.';
  }
}

export function mapApplyProblemFieldErrors(
  fieldErrors: readonly ProblemDetailFieldError[] | undefined,
): ProgramApplyFormErrors {
  const errors: { repositoryUrl?: string } = {};
  for (const fieldError of fieldErrors ?? []) {
    if (fieldError.field === 'repositoryUrl')
      errors.repositoryUrl = fieldError.message;
  }
  return errors;
}

export function resolveApplySubmitFailure(
  problem: ProblemDetail,
  action: ProgramApplyAction,
): {
  readonly fieldErrors: ProgramApplyFormErrors;
  readonly serverError: string | null;
} {
  const fieldErrors = mapApplyProblemFieldErrors(problem.fieldErrors);
  return {
    fieldErrors,
    serverError:
      Object.keys(fieldErrors).length > 0
        ? null
        : mapCreateApplicationError(problem, action),
  };
}

export function mapCreateApplicationError(
  problem: ProblemDetail,
  action: ProgramApplyAction = 'submit',
): string {
  switch (problem.code) {
    case 'APP_010':
      return '신청 기간이 아닙니다.';
    case 'APP_011':
      return '이미 제출한 신청이 있습니다.';
    case 'APP_022':
      return '연결할 저장소 주소를 확인해 주세요.';
    case 'APP_027':
      return '연결하려는 저장소를 찾을 수 없거나 비공개 저장소입니다. GitHub에 공개된 저장소만 연결할 수 있습니다.';
    case 'APP_019':
      return '팀 최소 인원을 충족한 뒤 신청해 주세요.';
    case 'APP_015':
      return '신청 항목을 확인해 주세요.';
    case 'APP_024':
      return '신청 항목이 너무 깁니다. 입력한 내용을 확인해 주세요.';
    case 'APP_016':
      return '신청 양식이 갱신되었습니다. 페이지를 새로고침해 주세요.';
    case 'APP_008':
      return '승인된 학생 계정만 신청할 수 있습니다.';
    default:
      return problem.detail || applyActionFailureMessage(action);
  }
}
