import { describe, expect, it } from 'vitest';
import type { ProblemDetail } from '@/lib/api-client';
import {
  applyActionFailureMessage,
  isApplicationPeriodOpen,
  mapApplyProblemFieldErrors,
  mapCreateApplicationError,
  remainingTeamMembers,
  resolveApplyBlockedReason,
  resolveApplySubmitFailure,
  resolveTeamMinimum,
  validateApplyForm,
} from './program-apply-flow';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

const baseProgram: ProgramDetail = {
  id: 'program-1',
  name: '합성 프로그램',
  organizer: '합성 주관',
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
  description: '설명',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: '2026-07-31T23:59:59.000Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: null },
  milestones: [],
};
const template: ApplicationFormTemplate = {
  key: 'basic',
  version: 1,
  name: '기본 신청서',
  participation: 'team',
  fields: [
    { key: 'applicantName', type: 'auto', label: '신청자', required: true },
  ],
};
const baseValues = {
  isRepositoryPublicationPlanned: true,
  repositoryConnectionMode: 'new',
  repositoryUrl: '',
  personalDataConsent: false,
} as const;
const problem = (code: string, detail = ''): ProblemDetail => ({
  type: 'about:blank',
  title: 'error',
  status: 400,
  detail,
  instance: '/programs/program-1/applications',
  code,
});

describe('program-apply-flow', () => {
  it('신청 기간 시작과 종료 경계를 포함한다', () => {
    expect(
      isApplicationPeriodOpen(
        baseProgram,
        Date.parse(baseProgram.applicationPeriod.startsAt),
      ),
    ).toBe(true);
    expect(
      isApplicationPeriodOpen(
        baseProgram,
        Date.parse(baseProgram.applicationPeriod.endsAt),
      ),
    ).toBe(true);
    expect(
      isApplicationPeriodOpen(
        baseProgram,
        Date.parse(baseProgram.applicationPeriod.startsAt) - 1,
      ),
    ).toBe(false);
    expect(
      isApplicationPeriodOpen(
        baseProgram,
        Date.parse(baseProgram.applicationPeriod.endsAt) + 1,
      ),
    ).toBe(false);
  });

  it('기간과 중복 신청을 차단하되 팀이 없는 학생도 신청 화면에 진입한다', () => {
    expect(
      resolveApplyBlockedReason(
        baseProgram,
        template,
        null,
        Date.parse('2026-08-01'),
      ),
    ).toBe('period-closed');
    expect(
      resolveApplyBlockedReason(
        {
          ...baseProgram,
          viewer: { role: 'STUDENT', applicationStatus: 'SUBMITTED' },
        },
        template,
        null,
        Date.parse('2026-07-15'),
      ),
    ).toBe('already-applied');
    expect(
      resolveApplyBlockedReason(
        baseProgram,
        template,
        null,
        Date.parse('2026-07-15'),
      ),
    ).toBeNull();
    expect(
      resolveApplyBlockedReason(
        baseProgram,
        template,
        'team-1',
        Date.parse('2026-07-15'),
      ),
    ).toBeNull();
  });

  it('요약 없이 신청하고 개인정보 동의 누락은 차단한다', () => {
    expect(validateApplyForm(baseValues)).toEqual({
      personalDataConsent: '개인정보 수집·이용에 동의해야 지원할 수 있습니다.',
    });
    expect(
      validateApplyForm({ ...baseValues, personalDataConsent: true }),
    ).toEqual({});
  });

  it('직접 연결하는 저장소 URL의 빈 값과 공백을 차단한다', () => {
    for (const repositoryUrl of ['', '  ']) {
      expect(
        validateApplyForm({
          ...baseValues,
          personalDataConsent: true,
          repositoryConnectionMode: 'own',
          repositoryUrl,
        }),
      ).toEqual({
        repositoryUrl:
          '연결할 repo URL을 입력하거나 새 저장소 생성을 선택해 주세요.',
      });
    }
    expect(
      validateApplyForm({
        ...baseValues,
        personalDataConsent: true,
        repositoryConnectionMode: 'own',
        repositoryUrl: 'https://github.com/synthetic-owner/synthetic-repo',
      }),
    ).toEqual({});
  });

  it('저장소 발급을 사용하지 않으면 URL을 요구하지 않는다', () => {
    expect(
      validateApplyForm(
        {
          ...baseValues,
          personalDataConsent: true,
          repositoryConnectionMode: 'own',
        },
        'create',
        false,
      ),
    ).toEqual({});
  });

  it('수정할 때는 저장소 연결과 동의를 다시 요구하지 않는다', () => {
    expect(
      validateApplyForm(
        { ...baseValues, title: '기존 제목', repositoryConnectionMode: 'own' },
        'edit',
      ),
    ).toEqual({});
  });

  it('서버 오류를 사용자 메시지로 매핑한다', () => {
    expect(mapCreateApplicationError(problem('APP_011'))).toContain('이미');
    expect(mapCreateApplicationError(problem('APP_016'))).toContain('양식');
    expect(mapCreateApplicationError(problem('APP_999', '상세 오류'))).toBe(
      '상세 오류',
    );
    expect(mapCreateApplicationError(problem('APP_024'))).not.toContain('요약');
  });

  it('저장소 필드 오류는 해당 칸에 표시하고 중복 배너를 띄우지 않는다', () => {
    const error = {
      ...problem('APP_027'),
      fieldErrors: [
        {
          field: 'repositoryUrl',
          code: 'APP_027',
          message: '공개 저장소를 연결해 주세요.',
        },
      ],
    };
    expect(mapApplyProblemFieldErrors(error.fieldErrors)).toEqual({
      repositoryUrl: '공개 저장소를 연결해 주세요.',
    });
    expect(resolveApplySubmitFailure(error, 'submit')).toEqual({
      fieldErrors: { repositoryUrl: '공개 저장소를 연결해 주세요.' },
      serverError: null,
    });
  });

  it('현재 없는 필드의 오류는 숨기지 않고 배너로 표시한다', () => {
    const error = {
      ...problem('APP_015', '신청 항목을 확인해 주세요.'),
      fieldErrors: [{ field: 'unknown', code: 'APP_015', message: '오류' }],
    };
    expect(resolveApplySubmitFailure(error, 'submit')).toEqual({
      fieldErrors: {},
      serverError: '신청 항목을 확인해 주세요.',
    });
    expect(mapCreateApplicationError(problem('APP_027'))).toContain('비공개');
  });

  it('제출과 저장 실패는 입력 보존과 재시도를 안내한다', () => {
    for (const action of ['submit', 'save'] as const) {
      expect(applyActionFailureMessage(action)).toContain(
        '입력한 내용은 그대로 남아',
      );
      expect(mapCreateApplicationError(problem('APP_999'), action)).toBe(
        applyActionFailureMessage(action),
      );
    }
  });

  it('취소 실패는 성공 여부를 단정하지 않고 상태 확인을 안내한다', () => {
    const message = applyActionFailureMessage('cancel');
    expect(message).toContain('현재 신청 상태를 확인');
    expect(message).not.toContain('입력한 내용은 그대로 남아');
    expect(mapCreateApplicationError(problem('APP_999'), 'cancel')).toBe(
      message,
    );
  });

  it('팀 최소 인원 설정과 부족 인원을 계산한다', () => {
    expect(resolveTeamMinimum({ memberCount: 1, minMembers: null })).toBeNull();
    expect(remainingTeamMembers(null)).toBe(0);
    expect(remainingTeamMembers({ memberCount: 1, teamMinSize: 3 })).toBe(2);
    expect(remainingTeamMembers({ memberCount: 3, teamMinSize: 3 })).toBe(0);
    expect(remainingTeamMembers({ memberCount: 4, teamMinSize: 3 })).toBe(0);
  });
});
