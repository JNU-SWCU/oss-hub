import { describe, expect, it } from 'vitest';
import type { ProblemDetail } from '@/lib/api-client';
import {
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

  it('필수 입력 검증 오류를 반환한다', () => {
    expect(
      validateApplyForm({
        title: '',
        summary: '',
        isRepositoryPublicationPlanned: true,
      }),
    ).toEqual({
      title: '제목을 입력해 주세요.',
      summary: '요약을 입력해 주세요.',
    });
    expect(
      validateApplyForm({
        title: '제목',
        summary: '요약',
        isRepositoryPublicationPlanned: true,
      }),
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
