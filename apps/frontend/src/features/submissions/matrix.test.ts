import { describe, expect, it } from 'vitest';
import {
  applyMatrixQuickFilter,
  buildMatrixSearchParams,
  cellForMilestone,
  formatMatrixDueDateTime,
  formatSubmittedAt,
  isMatrixFilterActive,
  isMilestoneWithoutRequiredItems,
  matrixCellAction,
  matrixEmptyKind,
  matrixPageStats,
  matrixRowAction,
  matrixRowHasEmptyCell,
  matrixRowTitle,
  matrixTotalPages,
  notSubmittedDeadline,
} from './matrix';
import type { MatrixCell, MatrixMilestone, MatrixRow } from './types';

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
  githubLogins: ['login-a', 'login-b', 'login-c'],
  cells: [submittedCell],
};

const personalRow: MatrixRow = {
  teamId: 'application-personal',
  applicationMode: 'PERSONAL',
  displayName: '홍길동',
  githubLogins: ['hong'],
  cells: [],
};

describe('buildMatrixSearchParams', () => {
  it('빈 검색어는 query에서 생략하고 page·pageSize만 보낸다', () => {
    const params = buildMatrixSearchParams({
      q: '   ',
      page: 1,
      pageSize: 20,
    });

    expect(params.toString()).toBe('page=1&pageSize=20');
    expect(params.has('applicationMode')).toBe(false);
  });

  it('검색어는 trim해 보내고 applicationMode는 보내지 않는다', () => {
    const params = buildMatrixSearchParams({
      q: ' 홍길동 ',
      page: 2,
      pageSize: 50,
    });

    expect(params.get('q')).toBe('홍길동');
    expect(params.has('applicationMode')).toBe(false);
    expect(params.get('page')).toBe('2');
    expect(params.get('pageSize')).toBe('50');
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
    const cell = cellForMilestone(personalRow, 'milestone-final');

    expect(cell).toEqual({
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

describe('notSubmittedDeadline', () => {
  const dueAt = '2026-08-20T23:59:59+09:00';

  it('마감 전에는 Asia/Seoul 달력일 기준 D-n을 표시한다', () => {
    const result = notSubmittedDeadline(
      dueAt,
      new Date('2026-07-31T12:00:00+09:00'),
    );

    expect(result).toEqual({ overdue: false, label: 'D-20' });
  });

  it('마감 당일 마감 전에는 오늘 마감으로 표시한다', () => {
    const result = notSubmittedDeadline(
      dueAt,
      new Date('2026-08-20T09:00:00+09:00'),
    );

    expect(result).toEqual({ overdue: false, label: '오늘 마감' });
  });

  it('같은 날이라도 dueAt 시각이 지나면 마감 초과다', () => {
    const result = notSubmittedDeadline(
      '2026-08-20T09:00:00+09:00',
      new Date('2026-08-20T10:00:00+09:00'),
    );

    expect(result).toEqual({ overdue: true, label: '마감 초과' });
  });

  it('마감이 지난 날짜는 N일 지남을 표시한다', () => {
    const result = notSubmittedDeadline(
      dueAt,
      new Date('2026-08-22T00:30:00+09:00'),
    );

    expect(result).toEqual({ overdue: true, label: '2일 지남' });
  });
});

describe('matrixRowTitle', () => {
  it('개인형은 신청자 이름, 팀형은 팀명(인원)이다', () => {
    expect(matrixRowTitle(personalRow)).toBe('홍길동');
    expect(matrixRowTitle(teamRow)).toBe('오픈소스팀(3)');
  });
});

describe('isMatrixFilterActive', () => {
  it('검색어가 있으면 활성이다', () => {
    expect(isMatrixFilterActive('')).toBe(false);
    expect(isMatrixFilterActive('  ')).toBe(false);
    expect(isMatrixFilterActive('홍')).toBe(true);
  });
});

describe('formatSubmittedAt', () => {
  it('Asia/Seoul 기준 "MM.DD HH:MM"으로 표시한다', () => {
    expect(formatSubmittedAt('2026-08-19T10:00:00+09:00')).toBe('08.19 10:00');

    expect(formatSubmittedAt('2026-08-19T01:00:00Z')).toBe('08.19 10:00');
  });
});

describe('formatMatrixDueDateTime', () => {
  it('Asia/Seoul 기준 한국어 날짜와 시각을 명시적으로 표시한다', () => {
    expect(formatMatrixDueDateTime('2026-09-12T23:59:59+09:00')).toBe(
      '2026년 9월 12일 (토) 오후 11:59',
    );
  });
});

describe('matrixCellAction', () => {
  const milestone: MatrixMilestone = {
    id: 'milestone-plan',
    name: '기획서',
    dueAt: '2026-08-20T23:59:59+09:00',
  };
  const before = new Date('2026-08-19T12:00:00+09:00');
  const after = new Date('2026-08-22T12:00:00+09:00');
  const missing: MatrixCell = {
    milestoneId: 'milestone-plan',
    submissionId: null,
    revision: null,
    status: 'NOT_SUBMITTED',
    deliveryStatus: 'MISSING',
    submittedAt: null,
    changesRequestedCount: 0,
  };

  it('(a) 필수 서류가 빠졌으면 마감 전은 미제출, 마감 후는 기한 지남이다', () => {
    expect(matrixCellAction(missing, milestone, before)).toEqual({
      status: 'NOT_SUBMITTED',
      late: false,
    });
    expect(matrixCellAction(missing, milestone, after)).toEqual({
      status: 'OVERDUE',
      late: false,
    });
    expect(
      matrixCellAction(
        { ...submittedCell, status: 'APPROVED', deliveryStatus: 'MISSING' },
        milestone,
        after,
      ).status,
    ).toBe('OVERDUE');
  });

  it('(b) 필수 서류가 없고 제출도 없으면 상태가 없다', () => {
    expect(
      matrixCellAction(
        { ...missing, deliveryStatus: 'NO_REQUIRED_ITEMS' },
        milestone,
        after,
      ),
    ).toEqual({ status: 'NONE', late: false });
    expect(
      matrixCellAction(
        { ...submittedCell, deliveryStatus: 'NO_REQUIRED_ITEMS' },
        milestone,
        after,
      ).status,
    ).toBe('SUBMITTED');
  });

  it.each([
    'NOT_SUBMITTED',
    'SUBMITTED',
    'CHANGES_REQUESTED',
    'APPROVED',
    'REJECTED',
  ] as const)('(c) 그 밖에는 검토 상태 %s를 그대로 쓴다', (status) => {
    expect(
      matrixCellAction({ ...submittedCell, status }, milestone, after),
    ).toEqual({ status, late: false });
  });

  it.each(['SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED'] as const)(
    '지각이어도 %s 판정은 유지하고 태그로 붙인다',
    (status) => {
      expect(
        matrixCellAction(
          { ...submittedCell, status, deliveryStatus: 'LATE' },
          milestone,
          after,
        ),
      ).toEqual({ status, late: true });
    },
  );
});

describe('matrixRowAction', () => {
  const first: MatrixMilestone = {
    id: 'm1',
    name: '1차',
    dueAt: '2026-08-20T23:59:59+09:00',
  };
  const second: MatrixMilestone = {
    id: 'm2',
    name: '2차',
    dueAt: '2026-09-20T23:59:59+09:00',
  };
  const milestones = [first, second];
  const now = new Date('2026-08-22T12:00:00+09:00');
  function rowWith(
    ...cells: readonly Pick<MatrixCell, 'status' | 'deliveryStatus'>[]
  ): MatrixRow {
    return {
      ...teamRow,
      cells: cells.map((item, index) => ({
        ...submittedCell,
        milestoneId: index === 0 ? 'm1' : 'm2',
        ...item,
      })),
    };
  }

  it.each([
    [
      'OVERDUE',
      { status: 'NOT_SUBMITTED', deliveryStatus: 'MISSING' },
      { status: 'SUBMITTED', deliveryStatus: 'COMPLETE' },
    ],
    [
      'SUBMITTED',
      { status: 'SUBMITTED', deliveryStatus: 'COMPLETE' },
      { status: 'CHANGES_REQUESTED', deliveryStatus: 'COMPLETE' },
    ],
    [
      'CHANGES_REQUESTED',
      { status: 'CHANGES_REQUESTED', deliveryStatus: 'COMPLETE' },
      { status: 'NOT_SUBMITTED', deliveryStatus: 'MISSING' },
    ],
    [
      'NOT_SUBMITTED',
      { status: 'REJECTED', deliveryStatus: 'COMPLETE' },
      { status: 'NOT_SUBMITTED', deliveryStatus: 'MISSING' },
    ],
    [
      'REJECTED',
      { status: 'APPROVED', deliveryStatus: 'COMPLETE' },
      { status: 'REJECTED', deliveryStatus: 'COMPLETE' },
    ],
    [
      'APPROVED',
      { status: 'APPROVED', deliveryStatus: 'LATE' },
      { status: 'NOT_SUBMITTED', deliveryStatus: 'NO_REQUIRED_ITEMS' },
    ],
    [
      'NONE',
      { status: 'NOT_SUBMITTED', deliveryStatus: 'NO_REQUIRED_ITEMS' },
      { status: 'NOT_SUBMITTED', deliveryStatus: 'NO_REQUIRED_ITEMS' },
    ],
  ] as const)('가장 급한 칸 상태 %s를 행 상태로 고른다', (expected, a, b) => {
    expect(matrixRowAction(rowWith(a, b), milestones, now)).toBe(expected);
  });

  it('필수 서류가 없는 단계를 상태 없음으로 판정한다', () => {
    const none = rowWith(
      { status: 'NOT_SUBMITTED', deliveryStatus: 'NO_REQUIRED_ITEMS' },
      { status: 'NOT_SUBMITTED', deliveryStatus: 'MISSING' },
    );
    expect(isMilestoneWithoutRequiredItems([none], first, now)).toBe(true);
    expect(isMilestoneWithoutRequiredItems([none], second, now)).toBe(false);
    expect(isMilestoneWithoutRequiredItems([], first, now)).toBe(false);
  });
});

describe('matrixPageStats', () => {
  const milestones: MatrixMilestone[] = [
    {
      id: 'milestone-plan',
      name: '기획서',
      dueAt: '2026-08-19T23:59:59+09:00',
    },
    {
      id: 'milestone-mid',
      name: '중간 보고',
      dueAt: '2026-09-12T23:59:59+09:00',
    },
  ];
  const now = new Date('2026-08-25T12:00:00+09:00');

  it('로드된 행의 칸마다 행동 상태를 센다', () => {
    const late: MatrixRow = {
      ...teamRow,
      cells: [{ ...submittedCell, deliveryStatus: 'LATE' }],
    };

    expect(matrixPageStats([late, personalRow], milestones, now)).toEqual({
      OVERDUE: 1,
      NOT_SUBMITTED: 2,
      SUBMITTED: 1,
      CHANGES_REQUESTED: 0,
      APPROVED: 0,
      REJECTED: 0,
      NONE: 0,
    });
  });

  it('행이 없으면 모든 값이 0이다', () => {
    expect(
      Object.values(matrixPageStats([], milestones, now)).every(
        (count) => count === 0,
      ),
    ).toBe(true);
  });
});

describe('matrixRowHasEmptyCell', () => {
  const milestones: MatrixMilestone[] = [
    {
      id: 'milestone-plan',
      name: '기획서',
      dueAt: '2026-08-19T23:59:59+09:00',
    },
    {
      id: 'milestone-mid',
      name: '중간 보고',
      dueAt: '2026-09-12T23:59:59+09:00',
    },
  ];

  it('일부만 제출한 팀은 빈 칸이 있지만 한 장도 안 낸 팀은 아니다', () => {
    expect(matrixRowHasEmptyCell(teamRow, milestones)).toBe(true);
  });

  it('전부 미제출인 팀은 빈 칸도 있고 한 장도 안 낸 팀이기도 하다', () => {
    expect(matrixRowHasEmptyCell(personalRow, milestones)).toBe(true);
  });

  it('모든 마일스톤을 제출한 팀은 빈 칸이 없다', () => {
    const fullRow: MatrixRow = {
      ...teamRow,
      cells: [
        submittedCell,
        { ...submittedCell, milestoneId: 'milestone-mid' },
      ],
    };
    expect(matrixRowHasEmptyCell(fullRow, milestones)).toBe(false);
  });
});

describe('applyMatrixQuickFilter', () => {
  const milestones: MatrixMilestone[] = [
    {
      id: 'milestone-plan',
      name: '기획서',
      dueAt: '2026-08-19T23:59:59+09:00',
    },
    {
      id: 'milestone-mid',
      name: '중간 보고',
      dueAt: '2026-09-12T23:59:59+09:00',
    },
  ];
  const rows = [teamRow, personalRow];
  const now = new Date('2026-08-25T12:00:00+09:00');

  it('ALL은 행을 그대로 돌려준다', () => {
    expect(applyMatrixQuickFilter(rows, milestones, 'ALL', now)).toEqual(rows);
  });

  it('행 상태가 고른 상태와 같은 행만 남긴다', () => {
    expect(applyMatrixQuickFilter(rows, milestones, 'OVERDUE', now)).toEqual([
      personalRow,
    ]);
  });

  it('현재 보고 있는 단계만으로 행 상태를 판정한다', () => {
    expect(
      applyMatrixQuickFilter(rows, milestones.slice(0, 1), 'SUBMITTED', now),
    ).toEqual([teamRow]);
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
