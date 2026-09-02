import { describe, expect, it } from 'vitest';
import {
  applyMatrixQuickFilter,
  buildMatrixSearchParams,
  cellForMilestone,
  formatMatrixDueDateTime,
  formatSubmittedAt,
  isLateSubmission,
  isMatrixFilterActive,
  matrixCellDisplay,
  matrixEmptyKind,
  matrixPageStats,
  matrixRowHasEmptyCell,
  matrixRowIsZeroSubmission,
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
  submittedAt: '2026-08-19T10:00:00+09:00',
  reviewUrl: '/programs/program-1/submissions/submission-existing/review',
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
  it('빈 검색어는 query에서 생략하고 page·pageSize만 보낸다', () => {
    // Given / When
    const params = buildMatrixSearchParams({
      q: '   ',
      page: 1,
      pageSize: 20,
    });

    // Then
    expect(params.toString()).toBe('page=1&pageSize=20');
    expect(params.has('applicationMode')).toBe(false);
  });

  it('검색어는 trim해 보내고 applicationMode는 보내지 않는다', () => {
    // Given / When
    const params = buildMatrixSearchParams({
      q: ' 홍길동 ',
      page: 2,
      pageSize: 50,
    });

    // Then
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

  it('같은 날이라도 dueAt 시각이 지나면 마감 초과다', () => {
    // Given / When
    const result = notSubmittedDeadline(
      '2026-08-20T09:00:00+09:00',
      new Date('2026-08-20T10:00:00+09:00'),
    );

    // Then
    expect(result).toEqual({ overdue: true, label: '마감 초과' });
  });

  it('마감이 지난 날짜는 마감 초과 D+n을 표시한다', () => {
    // Given / When
    const result = notSubmittedDeadline(
      dueAt,
      new Date('2026-08-22T00:30:00+09:00'),
    );

    // Then
    expect(result).toEqual({ overdue: true, label: '마감 초과 D+2' });
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
    // UTC로 저장된 시각도 Seoul 기준으로 변환한다(UTC 1:00 → Seoul 10:00).
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

describe('isLateSubmission', () => {
  const milestone: MatrixMilestone = {
    id: 'milestone-plan',
    name: '기획서',
    dueAt: '2026-08-19T23:59:59+09:00',
  };

  it('제출 시각이 마감 이후면 지각이다', () => {
    expect(
      isLateSubmission(
        { ...submittedCell, submittedAt: '2026-08-20T00:00:01+09:00' },
        milestone,
      ),
    ).toBe(true);
  });

  it('제출 시각이 마감 이전이면 지각이 아니다', () => {
    expect(
      isLateSubmission(
        { ...submittedCell, submittedAt: '2026-08-19T10:00:00+09:00' },
        milestone,
      ),
    ).toBe(false);
  });

  it('NOT_SUBMITTED 셀은 지각 판정 대상이 아니다', () => {
    const empty: MatrixCell = {
      milestoneId: 'milestone-plan',
      submissionId: null,
      revision: null,
      status: 'NOT_SUBMITTED',
      submittedAt: null,
      reviewUrl: null,
    };
    expect(isLateSubmission(empty, milestone)).toBe(false);
  });
});

describe('matrixCellDisplay', () => {
  const milestone: MatrixMilestone = {
    id: 'milestone-plan',
    name: '기획서',
    dueAt: '2026-08-19T23:59:59+09:00',
  };
  const notSubmitted: MatrixCell = {
    milestoneId: 'milestone-plan',
    submissionId: null,
    revision: null,
    status: 'NOT_SUBMITTED',
    submittedAt: null,
    reviewUrl: null,
  };

  it('저장 상태를 접지 않고 화면 값으로 그대로 옮긴다(QA49)', () => {
    expect(matrixCellDisplay(notSubmitted, milestone)).toBe('NOT_SUBMITTED');
    expect(
      matrixCellDisplay({ ...submittedCell, status: 'APPROVED' }, milestone),
    ).toBe('APPROVED');
    expect(
      matrixCellDisplay(
        { ...submittedCell, status: 'CHANGES_REQUESTED' },
        milestone,
      ),
    ).toBe('CHANGES_REQUESTED');
    expect(
      matrixCellDisplay({ ...submittedCell, status: 'REJECTED' }, milestone),
    ).toBe('REJECTED');
  });

  it('검토 전(SUBMITTED) 셀만 마감 초과 여부로 지각 제출을 가른다', () => {
    // Given — 마감 전 제출 → 검토 대기.
    expect(
      matrixCellDisplay(
        {
          ...submittedCell,
          status: 'SUBMITTED',
          submittedAt: '2026-08-19T10:00:00+09:00',
        },
        milestone,
      ),
    ).toBe('SUBMITTED');

    // Given — 마감 후 제출 → 지각 제출.
    expect(
      matrixCellDisplay(
        {
          ...submittedCell,
          status: 'SUBMITTED',
          submittedAt: '2026-08-20T00:00:01+09:00',
        },
        milestone,
      ),
    ).toBe('LATE');
  });

  it('이미 검토를 거친 승인·반려는 지각 여부와 무관하게 판정 그대로 보여준다', () => {
    // Given — 마감 후 제출됐지만 이미 승인된 셀.
    const lateApproved: MatrixCell = {
      ...submittedCell,
      status: 'APPROVED',
      submittedAt: '2026-08-20T00:00:01+09:00',
    };
    expect(matrixCellDisplay(lateApproved, milestone)).toBe('APPROVED');
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

  it('로드된 행 기준으로 채운 칸·빈 칸·미제출 팀·지각 건수를 센다', () => {
    // Given: teamRow는 기획서만 제출(지각), 중간 보고는 미제출.
    //        personalRow는 두 마일스톤 모두 미제출(한 장도 안 낸 팀).
    const late: MatrixRow = {
      ...teamRow,
      cells: [{ ...submittedCell, submittedAt: '2026-08-20T09:00:00+09:00' }],
    };

    // When
    const stats = matrixPageStats([late, personalRow], milestones);

    // Then
    expect(stats).toEqual({
      totalCells: 4,
      filledCells: 1,
      emptyCells: 3,
      zeroSubmissionRows: 1,
      lateCells: 1,
    });
  });

  it('행이 없으면 모든 값이 0이다', () => {
    expect(matrixPageStats([], milestones)).toEqual({
      totalCells: 0,
      filledCells: 0,
      emptyCells: 0,
      zeroSubmissionRows: 0,
      lateCells: 0,
    });
  });
});

describe('matrixRowHasEmptyCell / matrixRowIsZeroSubmission', () => {
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
    expect(matrixRowIsZeroSubmission(teamRow, milestones)).toBe(false);
  });

  it('전부 미제출인 팀은 빈 칸도 있고 한 장도 안 낸 팀이기도 하다', () => {
    expect(matrixRowHasEmptyCell(personalRow, milestones)).toBe(true);
    expect(matrixRowIsZeroSubmission(personalRow, milestones)).toBe(true);
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
    expect(matrixRowIsZeroSubmission(fullRow, milestones)).toBe(false);
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

  it('ALL은 행을 그대로 돌려준다', () => {
    expect(applyMatrixQuickFilter(rows, milestones, 'ALL')).toEqual(rows);
  });

  it('HAS_EMPTY는 빈 칸이 하나라도 있는 행만 남긴다', () => {
    expect(applyMatrixQuickFilter(rows, milestones, 'HAS_EMPTY')).toEqual(rows);
  });

  it('ZERO_SUBMISSION은 전부 미제출인 행만 남긴다', () => {
    expect(applyMatrixQuickFilter(rows, milestones, 'ZERO_SUBMISSION')).toEqual(
      [personalRow],
    );
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
