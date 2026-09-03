import { APPLICATION_ANSWER_MAX_LENGTHS } from './application-answer-limits';
import type { ProblemDetail, ProblemDetailFieldError } from '@/lib/api-client';
import type { ProgramTeam } from './api';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

/**
 * `manage-not-allowed`는 신청자도 팀장도 아닌 팀원이다 — 신청서를 읽을 수는 있지만
 * 고치거나 취소하지는 못한다(#1083). `period-closed`로 뭉뚱그리면 기다리면 열릴 줄 안다.
 */
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

/**
 * 새 신청서 생성 시점에만 쓰는 저장소 연결 방식.
 * 제출 시 API 경계(`createApplication`)에서 `NEW`/`OWN`으로 올려 보낸다.
 */
export const REPOSITORY_CONNECTION_MODES = ['new', 'own'] as const;
export type RepositoryConnectionMode =
  (typeof REPOSITORY_CONNECTION_MODES)[number];

export type ProgramApplyFormValues = {
  readonly title?: string;
  readonly summary: string;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string;
  readonly personalDataConsent: boolean;
};

export type ProgramApplyFormErrors = {
  readonly title?: string;
  readonly summary?: string;
  readonly repositoryUrl?: string;
  readonly personalDataConsent?: string;
};

export const EMPTY_APPLY_FORM: ProgramApplyFormValues = {
  summary: '',
  isRepositoryPublicationPlanned: true,
  repositoryConnectionMode: 'new',
  repositoryUrl: '',
  personalDataConsent: false,
};

export function applicationAnswersForTemplate(
  values: ProgramApplyFormValues,
  template: ApplicationFormTemplate,
  applicantName: string,
): Readonly<{ summary: string; title?: string }> {
  const summary = values.summary.trim();
  const hasLegacyTitleField = template.fields.some(
    (field) => field.key === 'title',
  );
  if (!hasLegacyTitleField) return { summary };

  const existingTitle = values.title?.trim();
  const normalizedApplicantName = applicantName.trim();
  return {
    title:
      existingTitle ||
      (normalizedApplicantName
        ? `${normalizedApplicantName} 신청서`
        : '신청서'),
    summary,
  };
}

export function applicationTemplateForDisplay(
  template: ApplicationFormTemplate,
): ApplicationFormTemplate {
  const fields = template.fields.filter((field) => field.key !== 'title');
  return fields.length === template.fields.length
    ? template
    : { ...template, fields };
}

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

/**
 * GitHub 저장소 연결·개인정보 동의는 **새 신청서 제출**에만 적용된다(프로토타입
 * 원문 범위). 수정(`edit`)은 승인 전 이미 제출된 신청서의 제목·요약만 고치는
 * 흐름이라 두 항목을 다시 요구하지 않는다.
 */
export function validateApplyForm(
  values: ProgramApplyFormValues,
  mode: 'create' | 'edit' = 'create',
  repositoryProvisioningEnabled = true,
): ProgramApplyFormErrors {
  return {
    ...(!values.summary.trim() ? { summary: '요약을 입력해 주세요.' } : {}),
    /*
     * 입력칸의 `maxLength` 는 **새로 치는 글자**만 막는다 — 상한이 생기기 전에 저장된
     * 긴 신청서를 수정 화면에 불러오면 그 값은 그대로 남아, 손대지 않고 저장해도 400 이 난다.
     * 그때 무엇을 줄여야 하는지 여기서 말해 준다.
     */
    ...(values.summary.trim().length > APPLICATION_ANSWER_MAX_LENGTHS.summary
      ? {
          summary: `요약은 ${APPLICATION_ANSWER_MAX_LENGTHS.summary.toLocaleString('ko-KR')}자를 넘을 수 없습니다.`,
        }
      : {}),
    ...(mode === 'create' &&
    repositoryProvisioningEnabled &&
    values.repositoryConnectionMode === 'own' &&
    !values.repositoryUrl.trim()
      ? {
          repositoryUrl:
            '연결할 repo URL을 입력하거나 새 저장소 생성을 선택해 주세요.',
        }
      : {}),
    ...(mode === 'create' && !values.personalDataConsent
      ? {
          personalDataConsent:
            '개인정보 수집·이용에 동의해야 지원할 수 있습니다.',
        }
      : {}),
  };
}

/** 신청 화면에서 확인 후 실행하는 동작. 실패 안내가 동작별로 갈린다. */
export type ProgramApplyAction = 'submit' | 'save' | 'cancel';

/**
 * 실패 안내는 "입력한 내용이 남아 있는지"를 먼저 말한다.
 * 신청서는 길어서, 다시 쓸지 판단하지 못한 채 새로고침하는 비용이 가장 크다.
 * submit·save 실패는 화면 상태를 그대로 두므로(program-apply-page의 catch는 values를
 * 건드리지 않는다) 남아 있다고 단언할 수 있고, cancel은 서버 상태가 갈리므로 확인을 권한다.
 */
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

/**
 * 서버가 실어 보낸 칸별 오류를 그 입력칸으로 옮긴다.
 *
 * ⚠ 옮기지 않으면 「신청 항목이 너무 깁니다」 배너 하나만 뜨고 **어느 칸을 얼마나 줄일지**
 *   학생이 알 수 없다. 서버가 애써 실어 보낸 정보를 화면이 버리는 셈이다.
 *   (`program-edit-flow.ts` 의 `mapProblemFieldErrors` 와 같은 방식이다.)
 */
export function mapApplyProblemFieldErrors(
  fieldErrors: readonly ProblemDetailFieldError[] | undefined,
): ProgramApplyFormErrors {
  const errors: { summary?: string; repositoryUrl?: string } = {};
  for (const fieldError of fieldErrors ?? []) {
    if (fieldError.field === 'summary') errors.summary = fieldError.message;
    if (fieldError.field === 'repositoryUrl')
      errors.repositoryUrl = fieldError.message;
  }
  return errors;
}

/**
 * 제출 실패를 「어느 칸에 붙일 것」과 「배너로 띄울 것」으로 가른다.
 *
 * 서버가 칸을 짚어 줬으면 배너는 띄우지 않는다 — 같은 말을 두 군데서 하면
 * 학생이 어느 쪽을 따라야 할지 헷갈린다.
 */
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
      // 칸별 안내는 `mapApplyProblemFieldErrors` 가 그 칸으로 옮긴다.
      // 여기 문구는 칸을 하나도 못 옮겼을 때의 마지막 안전망이다.
      return '연결하려는 저장소를 찾을 수 없거나 비공개 저장소입니다. GitHub에 공개된 저장소만 연결할 수 있습니다.';
    case 'APP_019':
      return '팀 최소 인원을 충족한 뒤 신청해 주세요.';
    case 'APP_015':
      return '신청 항목을 확인해 주세요.';
    case 'APP_024':
      // 칸별 안내는 `mapApplyProblemFieldErrors` 가 그 칸으로 옮긴다.
      // 여기 문구는 칸을 하나도 못 옮겼을 때의 마지막 안전망이다.
      return '신청 항목이 너무 깁니다. 요약 길이를 줄여 주세요.';
    case 'APP_016':
      return '신청 양식이 갱신되었습니다. 페이지를 새로고침해 주세요.';
    case 'APP_008':
      return '승인된 학생 계정만 신청할 수 있습니다.';
    default:
      return problem.detail || applyActionFailureMessage(action);
  }
}

export function teamSetupHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/teams`;
}
