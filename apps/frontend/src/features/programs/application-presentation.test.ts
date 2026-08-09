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

/**
 * ⚠ 이 스펙은 **개발 기계의 시간대를 UTC 로 바꾼 뒤** 확인한다.
 *
 * 개발 기계와 CI 가 이미 KST 면 `timeZone: 'Asia/Seoul'` 이 있으나 없으나 결과가
 * 같아서, 이 값을 지워도 아무 테스트도 알아채지 못한다(실제로 변이 검증에서
 * 통과해 버렸다). 컨테이너 `TZ` 를 Dockerfile 원문으로 고정한 것과 같은 이유다.
 */
describe('formatSubmittedAt', () => {
  const original = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'UTC';
  });

  afterAll(() => {
    // 원래 미설정이었으면 `process.env.TZ = undefined` 가 문자열 "undefined" 를
    // 넣어 기본 시간대가 UTC 로 떨어진다. 지워야 원래대로 돌아온다.
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('기계 시간대가 UTC 여도 서울 시각으로 적는다', () => {
    // 05:32Z 는 KST 오후 2:32 다. 기계 시간대를 따르면 오전 5:32 로 찍혀
    // 마감 직후 제출이 마감 전으로 읽힌다.
    expect(formatSubmittedAt('2026-08-05T05:32:00.000Z')).toContain(
      '오후 02:32',
    );
    expect(formatSubmittedAt('2026-08-05T05:32:00.000Z')).not.toContain(
      '오전 05:32',
    );
  });

  it('자정을 넘기는 제출은 날짜까지 서울 기준으로 넘어간다', () => {
    // 2026-08-20T15:30Z = KST 8/21 00:30. UTC 로 적으면 8/20 로 남아 마감일
    // 안에 낸 것처럼 읽힌다.
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

  it('ApiError 가 아니면 낡음으로 보지 않는다', () => {
    expect(staleApplicationDecisionTitle(new Error('network'))).toBeNull();
  });

  it('프로비저닝이 끝난 승인 되돌리기는 사람 말로 알린다', () => {
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(409, 'APP_023'))),
    ).toBe('저장소가 이미 만들어진 승인은 되돌릴 수 없습니다');
  });
});

/**
 * 학생 자유 입력이 교직원 화면에 그대로 그려지는 자리(#735).
 *
 * 쓰기 쪽에 위생 처리도 길이 상한도 없어서, 읽는 쪽이 마지막 방어선이다.
 */
describe('displayAnswerText', () => {
  it('문장 순서를 뒤집는 Bidi 표시를 걷어낸다', () => {
    // U+202E 하나면 뒤 문장이 거꾸로 표시된다 — 교직원이 학생이 제출하지 않은
    // 문장을 읽은 채 판정을 누른다.
    expect(displayAnswerText('앞\u202E뒤')).toBe('앞뒤');
  });

  it('제어문자를 걷어낸다', () => {
    expect(displayAnswerText('정상\u0007내용')).toBe('정상내용');
  });

  it('길이는 자르지 않는다', () => {
    // 잘린 지원 동기로 판정하게 만드는 것이 더 나쁘다.
    const long = '가'.repeat(REJECTION_REASON_MAX_LENGTH * 2);

    expect(displayAnswerText(long)).toBe(long);
    expect(displayAnswerText(long)).not.toContain('…');
  });

  it('줄바꿈은 살린다', () => {
    expect(displayAnswerText('첫 줄\n둘째 줄')).toBe('첫 줄\n둘째 줄');
  });

  it('빈 값은 빈 문자열이다', () => {
    // `null` 을 그대로 흘리면 화면에 "null" 이 찍힌다.
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
    // ⚠ 프로필 이름은 학생 본인이 쓴다. 그 검증이 문자 종류를 안 가리고
    // (`update-my-profile-request.dto.ts`), 신청 생성이 그 값을 그대로
    // `applicantName` 으로 복사한다 — 앞만 막으면 같은 문자가 여기로 되돌아온다.
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
    // 제어문자만 적어 낸 이름은 지우고 나면 빈 값이다 — 빈 제목이 뜨면 안 된다.
    expect(
      displayApplicantName({
        ...item,
        answers: { ...item.answers, applicantName: '\u202E\u0007' },
      }),
    ).toBe('계정 이름');
  });
});
