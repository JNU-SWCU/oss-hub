import { describe, expect, it } from 'vitest';
import {
  buildMatrixSearchParams,
  cellForMilestone,
  isMatrixFilterActive,
  MATRIX_DEFAULT_ORDER,
  matrixTotalPages,
} from './matrix';
import { formatSubmittedAt, seoulCalendarDayNumber } from './matrix-format';
import type { MatrixCell, MatrixRow } from './types';

const submittedCell: MatrixCell = {
  milestoneId: 'milestone-plan',
  submissionId: 'submission-existing',
  revision: 2,
  status: 'SUBMITTED',
  deliveryStatus: 'COMPLETE',
  submittedAt: '2026-08-19T10:00:00+09:00',
  changesRequestedCount: 0,
};

const teamRow: MatrixRow = {
  teamId: 'application-team',
  applicationMode: 'TEAM',
  displayName: '오픈소스팀',
  leaderName: '홍길동',
  githubLogins: ['login-a', 'login-b', 'login-c'],
  cells: [submittedCell],
};

describe('buildMatrixSearchParams', () => {
  it('sends the team-ascending pair explicitly and omits blank search and status', () => {
    const params = buildMatrixSearchParams({
      q: '   ',
      page: 1,
      pageSize: 20,
      ...MATRIX_DEFAULT_ORDER,
    });

    expect(params.toString()).toBe(
      'sort=team&direction=asc&page=1&pageSize=20',
    );
  });

  it('sends the submitted status and both sort params alongside search and paging', () => {
    const params = buildMatrixSearchParams({
      q: ' 홍길동 ',
      page: 2,
      pageSize: 50,
      status: 'SUBMITTED',
      sort: 'milestone:plan/2',
      direction: 'desc',
    });

    expect([...params]).toEqual([
      ['q', '홍길동'],
      ['status', 'SUBMITTED'],
      ['sort', 'milestone:plan/2'],
      ['direction', 'desc'],
      ['page', '2'],
      ['pageSize', '50'],
    ]);
    expect(params.toString()).toContain('sort=milestone%3Aplan%2F2');
  });
});

describe('matrixTotalPages', () => {
  it('uses the matching team count, not the number of document submissions', () => {
    expect(matrixTotalPages(41, 20)).toBe(3);
    expect(matrixTotalPages(40, 20)).toBe(2);
    expect(matrixTotalPages(1, 20)).toBe(1);
    expect(matrixTotalPages(0, 20)).toBe(0);
  });
});

describe('cellForMilestone', () => {
  it('preserves the server cell for a matching milestone', () => {
    expect(cellForMilestone(teamRow, 'milestone-plan')).toBe(submittedCell);
  });

  it('returns an empty slot when the cell is absent', () => {
    expect(cellForMilestone(teamRow, 'milestone-final')).toEqual({
      milestoneId: 'milestone-final',
      submissionId: null,
      revision: null,
      status: 'NOT_SUBMITTED',
      deliveryStatus: 'MISSING',
      submittedAt: null,
      changesRequestedCount: 0,
    });
  });
});

it('treats only nonblank search as active', () => {
  expect(isMatrixFilterActive('')).toBe(false);
  expect(isMatrixFilterActive('  ')).toBe(false);
  expect(isMatrixFilterActive('홍')).toBe(true);
});

it('calculates calendar day differences after the Seoul date rolls over', () => {
  const due = seoulCalendarDayNumber(new Date('2026-08-20T14:59:59Z'));
  const now = seoulCalendarDayNumber(new Date('2026-08-20T15:00:01Z'));
  expect(now - due).toBe(1);
});

it('formats submission time in Seoul regardless of timestamp offset', () => {
  expect(formatSubmittedAt('2026-08-19T10:00:00+09:00')).toBe('08.19 10:00');
  expect(formatSubmittedAt('2026-08-19T01:00:00Z')).toBe('08.19 10:00');
});
