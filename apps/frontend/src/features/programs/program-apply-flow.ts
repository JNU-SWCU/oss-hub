import type { ProblemDetail } from '@/lib/api-client';
import type { ProgramTeam } from './api';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

export type ProgramApplyBlockedReason =
  'period-closed' | 'already-applied' | 'team-required';

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
 * 새 신청서 생성 시점에만 쓰는 저장소 연결 방식. 백엔드 `Application`에는 아직
 * 대응 필드가 없다 — 값은 폼 안에서만 유지하고 제출 payload에는 실어 보내지
 * 않는다(자세한 계약은 apiContract 참고, 임의로 백엔드 스키마를 바꾸지 않는다).
 */
export const REPOSITORY_CONNECTION_MODES = ['new', 'own'] as const;
export type RepositoryConnectionMode =
  (typeof REPOSITORY_CONNECTION_MODES)[number];

export type ProgramApplyFormValues = {
  readonly title: string;
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
  title: '',
  summary: '',
  isRepositoryPublicationPlanned: true,
  repositoryConnectionMode: 'new',
  repositoryUrl: '',
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
  template: ApplicationFormTemplate,
  teamId: string | null,
  now: number = Date.now(),
): ProgramApplyBlockedReason | null {
  if (!isApplicationPeriodOpen(program, now)) return 'period-closed';
  if (program.viewer.applicationStatus !== null) return 'already-applied';
  if (template.participation === 'team' && teamId === null)
    return 'team-required';
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
): ProgramApplyFormErrors {
  return {
    ...(!values.title.trim() ? { title: '제목을 입력해 주세요.' } : {}),
    ...(!values.summary.trim() ? { summary: '요약을 입력해 주세요.' } : {}),
    ...(mode === 'create' &&
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

export function mapCreateApplicationError(
  problem: ProblemDetail,
  action: ProgramApplyAction = 'submit',
): string {
  switch (problem.code) {
    case 'APP_010':
      return '신청 기간이 아닙니다.';
    case 'APP_011':
      return '이미 제출한 신청이 있습니다.';
    case 'APP_012':
      return '팀 구성 후 신청할 수 있습니다.';
    case 'APP_019':
      return '팀 최소 인원을 충족한 뒤 신청해 주세요.';
    case 'APP_015':
      return '신청 항목을 확인해 주세요.';
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
