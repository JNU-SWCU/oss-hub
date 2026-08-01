import type { ProblemDetail } from '@/lib/api-client';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

export type ProgramApplyBlockedReason =
  'period-closed' | 'already-applied' | 'team-required';

export type ProgramApplyReadyState = {
  readonly kind: 'ready';
  readonly program: ProgramDetail;
  readonly template: ApplicationFormTemplate;
  readonly applicantName: string;
  readonly teamId: string | null;
};

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
  readonly title: string;
  readonly summary: string;
  readonly isRepositoryPublicationPlanned: boolean;
};

export type ProgramApplyFormErrors = {
  readonly title?: string;
  readonly summary?: string;
};

export const EMPTY_APPLY_FORM: ProgramApplyFormValues = {
  title: '',
  summary: '',
  isRepositoryPublicationPlanned: true,
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

export function validateApplyForm(
  values: ProgramApplyFormValues,
): ProgramApplyFormErrors {
  return {
    ...(!values.title.trim() ? { title: '제목을 입력해 주세요.' } : {}),
    ...(!values.summary.trim() ? { summary: '요약을 입력해 주세요.' } : {}),
  };
}

export function mapCreateApplicationError(problem: ProblemDetail): string {
  switch (problem.code) {
    case 'APP_010':
      return '신청 기간이 아닙니다.';
    case 'APP_011':
      return '이미 제출한 신청이 있습니다.';
    case 'APP_012':
      return '팀 구성 후 신청할 수 있습니다.';
    case 'APP_015':
      return '신청 항목을 확인해 주세요.';
    case 'APP_016':
      return '신청 양식이 갱신되었습니다. 페이지를 새로고침해 주세요.';
    case 'APP_008':
      return '승인된 학생 계정만 신청할 수 있습니다.';
    default:
      return problem.detail || '신청을 제출하지 못했습니다.';
  }
}

export function teamSetupHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/teams`;
}
