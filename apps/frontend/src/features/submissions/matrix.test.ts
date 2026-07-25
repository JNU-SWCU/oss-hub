import { describe, expect, it } from 'vitest';
import {
  buildMatrixSearchParams,
  cellForMilestone,
  isMatrixFilterActive,
  matrixEmptyKind,
  matrixRowTitle,
  matrixTotalPages,
  notSubmittedDeadline,
  parseMatrixModeFilter,
} from './matrix';
import type { MatrixCell, MatrixRow } from './types';

const submittedCell: MatrixCell = {
  milestoneId: 'milestone-plan',
  submissionId: 'submission-existing',
  revision: 2,
  status: 'SUBMITTED',
  submittedAt: '2026-08-19T10:00:00+09:00',
  reviewUrl: '/staff/programs/program-1/submissions/submission-existing/review',
};

const teamRow: MatrixRow = {
  applicationId: 'application-team',
  applicationMode: 'TEAM',
  displayName: '오픈소스팀',
  githubLogins: ['login-a', 'login-b', 'login-c'],
  cells: [submittedCell],
};

const personalRow: MatrixRow = {
  applicationId: 'application-personal',
  applicationMode: 'PERSONAL',
  displayName: '홍길동',
  githubLogins: ['hong'],
  cells: [],
};

describe('buildMatrixSearchParams', () => {
  it('빈 검색어와 ALL 형태는 query에서 생략하고 page·pageSize만 보낸다', () => {
    // Given / When
    const params = buildMatrixSearchParams({
      q: '   ',
      mode: 'ALL',
      page: 1,
      pageSize: 20,
    });

    // Then
    expect(params.toString()).toBe('page=1&pageSize=20');
  });

  it('검색어는 trim해 보내고 형태 필터는 applicationMode로 보낸다', () => {
    // Given / When
    const params = buildMatrixSearchParams({
      q: ' 홍길동 ',
      mode: 'TEAM',
      page: 2,
      pageSize: 50,
    });

    // Then
    expect(params.get('q')).toBe('홍길동');
    expect(params.get('applicationMode')).toBe('TEAM');
    expect(params.get('page')).toBe('2');
    expect(params.get('pageSize')).toBe('50');
  });
});

describe('parseMatrixModeFilter', () => {
  it('PERSONAL·TEAM만 인정하고 나머지는 ALL로 되돌린다', () => {
    expect(parseMatrixModeFilter('PERSONAL')).toBe('PERSONAL');
    expect(parseMatrixModeFilter('TEAM')).toBe('TEAM');
    expect(parseMatrixModeFilter('')).toBe('ALL');
    expect(parseMatrixModeFilter('BOGUS')).toBe('ALL');
  });
});

describe('matrixTotalPages', () => {
  it('total과 pageSize로 전체 페이지 수를 계산한다', () => {
    expect(matrixTotalPages(41, 20)).toBe(3);
    expect(matrixTotalPages(40, 20)).toBe(2);
    expect(matrixTotalPages(1, 20)).toBe(1);
    expect(matrixTotalPages(0, 20)).toBe(0);
  });
});

describe('cellForMilestone', () => {
  it('milestoneId가 일치하는 cell을 찾는다', () => {
    expect(cellForMilestone(teamRow, 'milestone-plan')).toBe(submittedCell);
  });

  it('cell이 누락되면 NOT_SUBMITTED 빈 cell로 방어한다', () => {
    // Given / When
    const cell = cellForMilestone(personalRow, 'milestone-final');

    // Then
    expect(cell).toEqual({
      milestoneId: 'milestone-final',
      submissionId: null,
      revision: null,
      status: 'NOT_SUBMITTED',
      submittedAt: null,
      reviewUrl: null,
    });
  });
});

describe('notSubmittedDeadline', () => {
  const dueAt = '2026-08-20T23:59:59+09:00';

  it('마감 전에는 Asia/Seoul 달력일 기준 D-n을 표시한다', () => {
    // Given / When
    const result = notSubmittedDeadline(
      dueAt,
      new Date('2026-07-31T12:00:00+09:00'),
    );

    // Then
    expect(result).toEqual({ overdue: false, label: 'D-20' });
  });

  it('마감 당일 마감 전에는 오늘 마감으로 표시한다', () => {
    // Given / When
    const result = notSubmittedDeadline(
      dueAt,
      new Date('2026-08-20T09:00:00+09:00'),
    );

    // Then
    expect(result).toEqual({ overdue: false, label: '오늘 마감' });
  });

  it('같은 날이라도 dueAt 시각이 지나면 OVERDUE다', () => {
    // Given / When
    const result = notSubmittedDeadline(
      '2026-08-20T09:00:00+09:00',
      new Date('2026-08-20T10:00:00+09:00'),
    );

    // Then
    expect(result).toEqual({ overdue: true, label: 'OVERDUE' });
  });

  it('마감이 지난 날짜는 OVERDUE D+n을 표시한다', () => {
    // Given / When
    const result = notSubmittedDeadline(
      dueAt,
      new Date('2026-08-22T00:30:00+09:00'),
    );

    // Then
    expect(result).toEqual({ overdue: true, label: 'OVERDUE D+2' });
  });
});

describe('matrixRowTitle', () => {
  it('개인형은 신청자 이름, 팀형은 팀명(인원)이다', () => {
    expect(matrixRowTitle(personalRow)).toBe('홍길동');
    expect(matrixRowTitle(teamRow)).toBe('오픈소스팀(3)');
  });
});

describe('isMatrixFilterActive', () => {
  it('검색어 또는 형태 필터가 있으면 활성이다', () => {
    expect(isMatrixFilterActive('', 'ALL')).toBe(false);
    expect(isMatrixFilterActive('  ', 'ALL')).toBe(false);
    expect(isMatrixFilterActive('홍', 'ALL')).toBe(true);
    expect(isMatrixFilterActive('', 'TEAM')).toBe(true);
  });
});

describe('matrixEmptyKind', () => {
  it('마일스톤 없음이 최우선이고, 빈 행은 필터 여부로 구분한다', () => {
    expect(
      matrixEmptyKind({ milestoneCount: 0, rowCount: 0, filterActive: false }),
    ).toBe('no-milestones');
    expect(
      matrixEmptyKind({ milestoneCount: 3, rowCount: 0, filterActive: false }),
    ).toBe('no-applications');
    expect(
      matrixEmptyKind({ milestoneCount: 3, rowCount: 0, filterActive: true }),
    ).toBe('no-results');
    expect(
      matrixEmptyKind({ milestoneCount: 3, rowCount: 2, filterActive: true }),
    ).toBeNull();
  });
});
