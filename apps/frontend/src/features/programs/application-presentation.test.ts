import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import {
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
