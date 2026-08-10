import { describe, expect, it } from 'vitest';
import type { ProblemDetail } from '@/lib/api-client';
import {
  applyActionFailureMessage,
  isApplicationPeriodOpen,
  mapCreateApplicationError,
  remainingTeamMembers,
  resolveApplyBlockedReason,
  resolveTeamMinimum,
  teamSetupHref,
  validateApplyForm,
} from './program-apply-flow';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

const baseProgram: ProgramDetail = {
  id: 'program-1',
  name: '합성 프로그램',
  organizer: '합성 주관',
  category: 'BASIC',
  description: '설명',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: '2026-07-31T23:59:59.000Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: null },
  milestones: [],
};

const individualTemplate: ApplicationFormTemplate = {
  key: 'basic',
  version: 1,
  name: '기본 신청서',
  participation: 'individual',
  fields: [
    {
      key: 'applicantName',
      type: 'auto',
      label: '신청자',
      required: true,
    },
    { key: 'title', type: 'text', label: '제목', required: true },
    { key: 'summary', type: 'textarea', label: '요약', required: true },
  ],
};

const teamTemplate: ApplicationFormTemplate = {
  ...individualTemplate,
  key: 'oss-contest',
  participation: 'team',
};

describe('program-apply-flow', () => {
  it('신청 기간 개폐를 판별한다', () => {
    expect(
      isApplicationPeriodOpen(
        baseProgram,
        Date.parse('2026-07-15T00:00:00.000Z'),
      ),
    ).toBe(true);
    expect(
      isApplicationPeriodOpen(
        baseProgram,
        Date.parse('2026-08-01T00:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('기간 마감·중복·팀 필수 blocked 사유를 고른다', () => {
    expect(
      resolveApplyBlockedReason(
        baseProgram,
        individualTemplate,
        null,
        Date.parse('2026-08-01T00:00:00.000Z'),
      ),
    ).toBe('period-closed');

    expect(
      resolveApplyBlockedReason(
        {
          ...baseProgram,
          viewer: { role: 'STUDENT', applicationStatus: 'SUBMITTED' },
        },
        individualTemplate,
        null,
        Date.parse('2026-07-15T00:00:00.000Z'),
      ),
    ).toBe('already-applied');

    expect(
      resolveApplyBlockedReason(
        { ...baseProgram, category: 'OSS_CONTEST' },
        teamTemplate,
        null,
        Date.parse('2026-07-15T00:00:00.000Z'),
      ),
    ).toBe('team-required');

    expect(
      resolveApplyBlockedReason(
        { ...baseProgram, category: 'OSS_CONTEST' },
        teamTemplate,
        'team-1',
        Date.parse('2026-07-15T00:00:00.000Z'),
      ),
    ).toBe(null);
  });

  const baseValues = {
    title: '',
    summary: '',
    isRepositoryPublicationPlanned: true,
    repositoryConnectionMode: 'new',
    repositoryUrl: '',
    personalDataConsent: false,
  } as const;

  it('필수 입력 검증 오류를 반환한다', () => {
    expect(validateApplyForm(baseValues)).toEqual({
      title: '제목을 입력해 주세요.',
      summary: '요약을 입력해 주세요.',
      personalDataConsent: '개인정보 수집·이용에 동의해야 지원할 수 있습니다.',
    });
    expect(
      validateApplyForm({
        ...baseValues,
        title: '제목',
        summary: '요약',
        personalDataConsent: true,
      }),
    ).toEqual({});
  });

  it('저장소를 직접 연결하려면 URL이 필요하다', () => {
    expect(
      validateApplyForm({
        ...baseValues,
        title: '제목',
        summary: '요약',
        personalDataConsent: true,
        repositoryConnectionMode: 'own',
        repositoryUrl: '  ',
      }),
    ).toEqual({
      repositoryUrl:
        '연결할 repo URL을 입력하거나 새 저장소 생성을 선택해 주세요.',
    });
    expect(
      validateApplyForm({
        ...baseValues,
        title: '제목',
        summary: '요약',
        personalDataConsent: true,
        repositoryConnectionMode: 'own',
        repositoryUrl: 'https://github.com/team/repo',
      }),
    ).toEqual({});
  });

  it('수정 모드에서는 저장소 연결·개인정보 동의를 다시 요구하지 않는다', () => {
    expect(
      validateApplyForm(
        {
          ...baseValues,
          title: '제목',
          summary: '요약',
          personalDataConsent: false,
          repositoryConnectionMode: 'own',
          repositoryUrl: '',
        },
        'edit',
      ),
    ).toEqual({});
  });

  it('서버 오류 코드를 사용자 메시지로 매핑한다', () => {
    const problem = (code: string): ProblemDetail => ({
      type: 'about:blank',
      title: 'error',
      status: 400,
      detail: 'fallback',
      instance: '/programs/x/applications',
      code,
    });
    expect(mapCreateApplicationError(problem('APP_011'))).toContain('이미');
    expect(mapCreateApplicationError(problem('APP_016'))).toContain('양식');
    expect(mapCreateApplicationError(problem('APP_999'))).toBe('fallback');
  });

  it('팀 구성 CTA 경로를 만든다', () => {
    expect(teamSetupHref('seed:program')).toBe(
      '/programs/seed%3Aprogram/teams',
    );
  });

  // #355 — 신청서는 길어서 "다시 써야 하나"를 판단하지 못하는 비용이 가장 크다.
  // 입력이 남아 있다는 단언과 다음 행동이 한 문장에 함께 있어야 한다.
  it('제출 실패는 입력이 남아 있다는 사실과 다음 행동을 함께 알린다', () => {
    expect(applyActionFailureMessage('submit')).toBe(
      '신청서를 제출하지 못했습니다. 입력한 내용은 그대로 남아 있으니 잠시 후 다시 제출해 주세요.',
    );
  });

  it('저장 실패도 입력 보존을 단언한다', () => {
    expect(applyActionFailureMessage('save')).toBe(
      '신청서를 저장하지 못했습니다. 입력한 내용은 그대로 남아 있으니 잠시 후 다시 저장해 주세요.',
    );
  });

  // 취소는 서버 상태가 갈릴 수 있어 "남아 있다"고 단언하면 거짓이 된다.
  it('취소 실패는 입력 보존을 단언하지 않고 현재 상태 확인을 권한다', () => {
    const message = applyActionFailureMessage('cancel');
    expect(message).toBe(
      '신청을 취소하지 못했습니다. 페이지를 새로고침해 현재 신청 상태를 확인한 뒤 다시 시도해 주세요.',
    );
    expect(message).not.toContain('입력한 내용은 그대로 남아');
  });

  it('코드를 모르는 서버 오류의 fallback 도 동작별 안내를 쓴다', () => {
    const unknown: ProblemDetail = {
      type: 'about:blank',
      title: 'error',
      status: 500,
      detail: '',
      instance: '/programs/x/applications',
      code: 'APP_999',
    };
    expect(mapCreateApplicationError(unknown)).toBe(
      applyActionFailureMessage('submit'),
    );
    expect(mapCreateApplicationError(unknown, 'cancel')).toBe(
      applyActionFailureMessage('cancel'),
    );
  });

  it('최소 인원 설정이 없으면 제한하지 않는다', () => {
    // Given
    const team = { memberCount: 1, minMembers: null };

    // When
    const minimum = resolveTeamMinimum(team);

    // Then
    expect(minimum).toBeNull();
    expect(remainingTeamMembers(minimum)).toBe(0);
  });

  it('최소 인원을 충족하거나 초과하면 부족 인원이 없다', () => {
    expect(remainingTeamMembers({ memberCount: 2, teamMinSize: 2 })).toBe(0);
    expect(remainingTeamMembers({ memberCount: 3, teamMinSize: 2 })).toBe(0);
  });
});
