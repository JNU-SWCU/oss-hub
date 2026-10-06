import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import { REJECTION_REASON_MAX_LENGTH } from '@/lib/display-text';
import {
  displayAnswerText,
  displayApplicantName,
  formatSubmittedAt,
  participationLabel,
  staleApplicationDecisionTitle,
} from './application-presentation';
import type { ApplicationListItem } from './types';

const item: ApplicationListItem = {
  id: 'app-1',
  programId: 'program-1',
  repositoryConnectionMode: 'NEW',
  repositoryUrl: null,
  status: 'SUBMITTED',
  rejectionReason: null,
  repositoryProvisioning: {
    enabled: false,
    jobStatus: 'DISABLED',
    updatedAt: '2026-08-05T05:32:00.000Z',
    safeErrorClass: null,
  },
  isRepositoryPublicationPlanned: true,
  repository: null,
  submittedAt: '2026-08-05T05:32:00.000Z',
  participation: 'INDIVIDUAL',
  applicant: { id: 'student-1', name: '계정 이름', nickname: 'login-1' },
  team: null,
  answers: { applicantName: '', title: '제목', summary: '요약' },
};

describe('formatSubmittedAt', () => {
  const original = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'UTC';
  });

  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('기계 시간대가 UTC 여도 서울 시각으로 적는다', () => {
    expect(formatSubmittedAt('2026-08-05T05:32:00.000Z')).toContain(
      '오후 02:32',
    );
    expect(formatSubmittedAt('2026-08-05T05:32:00.000Z')).not.toContain(
      '오전 05:32',
    );
  });

  it('자정을 넘기는 제출은 날짜까지 서울 기준으로 넘어간다', () => {
    expect(formatSubmittedAt('2026-08-20T15:30:00.000Z')).toContain('8월 21일');
  });
});

describe('displayApplicantName', () => {
  it('신청서에 적은 이름이 비면 계정 이름으로 내려간다', () => {
    expect(displayApplicantName(item)).toBe('계정 이름');
  });

  it('둘 다 비면 GitHub 핸들을 쓴다', () => {
    expect(
      displayApplicantName({
        ...item,
        applicant: { ...item.applicant, name: null },
      }),
    ).toBe('login-1');
  });
});

describe('participationLabel', () => {
  it('팀이 없으면 인원만 적는다', () => {
    expect(participationLabel(item)).toBe('1명');
  });

  it('팀이 있으면 팀명과 인원을 함께 적는다', () => {
    expect(
      participationLabel({
        ...item,
        team: { id: 'team-1', name: '합성 팀', memberCount: 3 },
      }),
    ).toBe('합성 팀 (3명)');
  });
});

describe('staleApplicationDecisionTitle', () => {
  const problem = (status: number, code: string): ProblemDetail => ({
    type: 'about:blank',
    title: 'error',
    status,
    detail: 'detail',
    instance: 'urn:test:applications:app-1',
    code,
  });

  it('학생이 먼저 취소해 404가 오면 취소된 신청임을 알리고 목록을 다시 불러오게 한다', () => {
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(404, 'APP_001'))),
    ).toBe('신청이 이미 취소되었습니다');
  });

  it('다른 운영자가 먼저 판정해 409가 오면 상태 변경으로 알린다', () => {
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(409, 'APP_002'))),
    ).toBe('신청 상태가 변경되었습니다');
  });

  it('404와 409는 서로 다른 문구를 쓴다 — 교직원이 원인을 구분할 수 있어야 한다', () => {
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(404, 'APP_001'))),
    ).not.toBe(
      staleApplicationDecisionTitle(new ApiError(problem(409, 'APP_002'))),
    );
  });

  it('프로비저닝이 끝난 승인을 반려로 바꾸려면 코드만으로도 사람 말 안내를 쓴다', () => {
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(409, 'APP_023'))),
    ).toBe('저장소가 이미 만들어진 승인은 반려로 바꿀 수 없습니다');
  });

  it('revertBlockedReason 이 같이 실려도 같은 사람 말 안내를 쓴다', () => {
    expect(
      staleApplicationDecisionTitle(
        new ApiError({
          ...problem(409, 'APP_023'),
          revertBlockedReason:
            'repository provision already succeeded; undo is locked to protect the provisioned repository',
        } as ProblemDetail & { readonly revertBlockedReason: string }),
      ),
    ).toBe('저장소가 이미 만들어진 승인은 반려로 바꿀 수 없습니다');
  });

  it('일반 409와 전환 잠금 409는 서로 다른 문구를 쓴다', () => {
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(409, 'APP_002'))),
    ).not.toBe(
      staleApplicationDecisionTitle(new ApiError(problem(409, 'APP_023'))),
    );
  });

  it('권한·검증 실패는 목록 재조회 경로로 보내지 않는다', () => {
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(403, 'APP_004'))),
    ).toBeNull();
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(400, 'APP_003'))),
    ).toBeNull();
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(500, 'SYS_001'))),
    ).toBeNull();
  });

  it('네트워크 오류처럼 ApiError가 아닌 실패는 판단하지 않는다', () => {
    expect(staleApplicationDecisionTitle(new Error('network'))).toBeNull();
    expect(staleApplicationDecisionTitle(null)).toBeNull();
    expect(staleApplicationDecisionTitle({ status: 404 })).toBeNull();
  });
});

describe('displayAnswerText', () => {
  it('문장 순서를 뒤집는 Bidi 표시를 걷어낸다', () => {
    expect(displayAnswerText('앞\u202E뒤')).toBe('앞뒤');
  });

  it('제어문자를 걷어낸다', () => {
    expect(displayAnswerText('정상\u0007내용')).toBe('정상내용');
  });

  it('길이는 자르지 않는다', () => {
    const long = '가'.repeat(REJECTION_REASON_MAX_LENGTH * 2);

    expect(displayAnswerText(long)).toBe(long);
    expect(displayAnswerText(long)).not.toContain('…');
  });

  it('줄바꿈은 살린다', () => {
    expect(displayAnswerText('첫 줄\n둘째 줄')).toBe('첫 줄\n둘째 줄');
  });

  it('빈 값은 빈 문자열이다', () => {
    expect(displayAnswerText('')).toBe('');
    expect(displayAnswerText('   ')).toBe('');
  });
});

describe('displayApplicantName', () => {
  it('신청서에 적은 이름도 위생 처리를 지난다', () => {
    expect(
      displayApplicantName({
        ...item,
        answers: { ...item.answers, applicantName: '학생\u202E이름' },
      }),
    ).toBe('학생이름');
  });

  it('계정 이름 fallback 도 위생 처리를 지난다', () => {
    expect(
      displayApplicantName({
        ...item,
        answers: { ...item.answers, applicantName: '' },
        applicant: { ...item.applicant, name: '계정\u202E이름' },
      }),
    ).toBe('계정이름');
  });

  it('GitHub 핸들 fallback 도 위생 처리를 지난다', () => {
    expect(
      displayApplicantName({
        ...item,
        answers: { ...item.answers, applicantName: '' },
        applicant: { ...item.applicant, name: null, nickname: 'login\u202E1' },
      }),
    ).toBe('login1');
  });

  it('위생 처리 후 비면 계정 이름으로 내려간다', () => {
    expect(
      displayApplicantName({
        ...item,
        answers: { ...item.answers, applicantName: '\u202E\u0007' },
      }),
    ).toBe('계정 이름');
  });
});
