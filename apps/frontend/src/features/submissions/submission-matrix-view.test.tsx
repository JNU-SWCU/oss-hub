import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SubmissionMatrixView } from './components/submission-matrix-view';
import type { SubmissionMatrixViewProps } from './components/submission-matrix-view';
import type { MatrixCell, SubmissionMatrixPage } from './types';

const NOW = new Date('2026-09-15T12:00:00+09:00');

function cell(input: {
  readonly milestoneId: string;
  readonly submissionId?: string;
  readonly revision?: number;
  readonly status: MatrixCell['status'];
}): MatrixCell {
  if (input.status === 'NOT_SUBMITTED') {
    return {
      milestoneId: input.milestoneId,
      submissionId: null,
      revision: null,
      status: 'NOT_SUBMITTED',
      deliveryStatus: 'MISSING',
      submittedAt: null,
      reviewUrl: null,
      changesRequestedCount: 0,
    };
  }
  const submissionId = input.submissionId ?? 'submission-existing';
  return {
    milestoneId: input.milestoneId,
    submissionId,
    revision: input.revision ?? 1,
    status: input.status,
    deliveryStatus: 'COMPLETE',
    submittedAt: '2026-08-19T10:00:00+09:00',
    reviewUrl: `/programs/program-1/submissions/${submissionId}/review`,
    changesRequestedCount: 0,
  };
}

const matrixData: SubmissionMatrixPage = {
  milestones: [
    {
      id: 'milestones-overdue',
      name: '기획서',
      dueAt: '2026-09-10T23:59:59+09:00',
    },
    {
      id: 'milestone-mid',
      name: '중간 보고',
      dueAt: '2026-09-12T23:59:59+09:00',
    },
    {
      id: 'milestones-upcoming',
      name: '최종 제출',
      dueAt: '2026-10-30T23:59:59+09:00',
    },
  ],
  rows: [
    {
      teamId: 'application-personal',
      applicationMode: 'PERSONAL',
      displayName: '홍길동',
      githubLogins: ['hong'],
      cells: [
        cell({
          milestoneId: 'milestones-overdue',
          submissionId: 'submission-approved',
          status: 'APPROVED',
        }),
        cell({
          milestoneId: 'milestone-mid',
          submissionId: 'submission-changes-requested',
          revision: 2,
          status: 'CHANGES_REQUESTED',
        }),
        cell({ milestoneId: 'milestones-upcoming', status: 'NOT_SUBMITTED' }),
      ],
    },
    {
      teamId: 'application-team',
      applicationMode: 'TEAM',
      displayName: '오픈소스팀',
      githubLogins: ['login-a', 'login-b', 'login-c'],
      cells: [
        cell({
          milestoneId: 'milestones-overdue',
          submissionId: 'submission-existing',
          status: 'SUBMITTED',
        }),
        cell({ milestoneId: 'milestone-mid', status: 'NOT_SUBMITTED' }),
        cell({
          milestoneId: 'milestones-upcoming',
          submissionId: 'submission-rejected',
          status: 'REJECTED',
        }),
      ],
    },
  ],
  page: 1,
  pageSize: 20,
  total: 2,
};

const handlers = {
  onSearchChange: vi.fn(),
  onSearch: vi.fn(),
  onQuickFilterChange: vi.fn(),
  onResetFilters: vi.fn(),
  onPageChange: vi.fn(),
  onRetry: vi.fn(),
};

function render(overrides: Partial<SubmissionMatrixViewProps> = {}): string {
  return renderToStaticMarkup(
    <SubmissionMatrixView
      programId="program-1"
      data={matrixData}
      search=""
      filterActive={false}
      quickFilter="ALL"
      isLoading={false}
      errorMessage={null}
      now={NOW}
      selectedMilestoneId={null}
      {...handlers}
      onSelectMilestone={vi.fn()}
      {...overrides}
    />,
  );
}

describe('SubmissionMatrixView', () => {
  it('개인·팀 행을 같은 매트릭스에 표시하고 셀에 최신 판정 상태를 보여준다(QA49)', () => {
    const html = render();

    expect(html).toContain('홍길동 · 개인');
    expect(html).toContain('오픈소스팀(3)');
    expect(html).not.toContain('오픈소스팀(3) · 팀');
    expect(html).toContain('@hong');
    expect(html).toContain('@login-a @login-b @login-c');

    expect(html).toContain('기획서');
    expect(html).toContain('9월 10일 마감');

    expect(html).toContain('미제출');
    expect(html).toContain('승인');
    expect(html).toContain('보완 요청');
    expect(html).toContain('반려');
    expect(html).toContain('검토 대기');
    expect(html).toContain('기한 지남');

    expect(html).not.toContain('제출 전');
    expect(html).not.toContain('보완 필요');
    expect(html).not.toContain('최종 반려');
  });

  it('선택한 마일스톤은 그 단계 열만 보여 주고 단계명·마감을 명시한다', () => {
    const html = render({ selectedMilestoneId: 'milestone-mid' });
    const table = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? '';

    expect(table).toContain('중간 보고');
    expect(table).not.toContain('기획서');
    expect(table).not.toContain('최종 제출');
    expect(html).toContain('data-slot="matrix-focus-summary"');
    expect(html).not.toContain('선택한 제출 단계의 현황');
    expect(html).not.toContain('필수 서류가 없는 단계라');
    expect(html).toContain('2026년 9월 12일 (토) 오후 11:59');
    expect(html).not.toContain('표를 좌우로 스크롤할 수 있습니다.');
  });

  it('모든 단계와 알 수 없는 단계는 전체 열을 보여 준다', () => {
    const allHtml = render();
    const unknownHtml = render({ selectedMilestoneId: 'missing' });

    for (const html of [allHtml, unknownHtml]) {
      const table = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? '';
      expect(table).toContain('기획서');
      expect(table).toContain('중간 보고');
      expect(table).toContain('최종 제출');
      expect(html).not.toContain('data-slot="matrix-focus-summary"');
      expect(html).toContain('표를 좌우로 스크롤할 수 있습니다.');
    }
  });

  it('한 줄 단계 칩에 모든 단계를 제공하고 선택을 접근성 상태로 알린다', () => {
    const html = render({ selectedMilestoneId: 'milestone-mid' });

    expect(html).toContain('aria-label="볼 제출 단계"');
    expect(html).toContain('>모든 단계<');
    expect(html).toContain('중간 보고');
    expect(html).not.toContain('선택됨');
    expect(html).toContain('data-slot="matrix-stage-navigation"');
    expect(html).not.toContain('<select');
  });

  it('선택한 단계에서는 0건이 아닌 상태 칩만 보이고 통계 상자와 D-n을 숨긴다', () => {
    const html = render({ selectedMilestoneId: 'milestone-mid' });

    expect(html).not.toContain('단계별 상태');
    expect(html).toContain('보완 요청 중 1');
    expect(html).toContain('기한 지남 1');
    expect(html).not.toContain('반려 0');
    expect(html).not.toContain('미제출 0');

    const upcoming = render({ selectedMilestoneId: 'milestones-upcoming' });
    expect(upcoming).toContain('>미제출<');
    expect(upcoming).not.toContain('D-45');
  });

  it('미제출 칸은 기한 지남이면 N일 지남을, 모든 단계 보기에서는 D-n을 붙인다', () => {
    const html = render();

    expect(html).toContain('3일 지남');
    expect(html).toContain('D-45');
  });

  it.each(['ALL', 'OVERDUE'] as const)(
    '필수 서류가 없는 단계는 %s 필터에서도 —와 안내를 보여 주고 칩을 숨긴다',
    (quickFilter) => {
      const html = render({
        selectedMilestoneId: 'milestone-mid',
        quickFilter,
        data: {
          ...matrixData,
          rows: matrixData.rows.map((row) => ({
            ...row,
            cells: row.cells.map((item) =>
              item.milestoneId === 'milestone-mid'
                ? {
                    ...cell({
                      milestoneId: 'milestone-mid',
                      status: 'NOT_SUBMITTED',
                    }),
                    deliveryStatus: 'NO_REQUIRED_ITEMS' as const,
                  }
                : item,
            ),
          })),
        },
      });

      expect(html).toContain('필수 서류가 없는 단계라 챙길 미제출이 없어요.');
      expect(html.match(/aria-label="필수 서류 없음"/g)).toHaveLength(2);
      expect(html).toContain('>—<');
      expect(html).not.toContain('>상태</p>');
      expect(html).not.toContain('data-slot="status-badge"');
    },
  );

  it.each([
    [null, NOW, '기한 지남', '5일 지남'],
    ['milestones-overdue', NOW, '기한 지남', '5일 지남'],
    [null, new Date('2026-09-09T12:00:00+09:00'), '미제출', 'D-1'],
    [
      'milestones-overdue',
      new Date('2026-09-09T12:00:00+09:00'),
      '미제출',
      null,
    ],
  ] as const)(
    '일부 제출한 셀도 행동 상태의 마감을 표시한다 (%s, %s)',
    (selectedMilestoneId, now, status, deadline) => {
      const html = render({
        selectedMilestoneId,
        now,
        data: {
          ...matrixData,
          rows: matrixData.rows.map((row) => ({
            ...row,
            cells: row.cells.map((item) =>
              item.status === 'APPROVED'
                ? {
                    ...item,
                    deliveryStatus: 'MISSING' as const,
                    changesRequestedCount: 2,
                  }
                : item,
            ),
          })),
        },
      });
      const link = html.match(
        /<a\b[^>]*href="\/programs\/program-1\/submissions\/submission-approved\/review"[^>]*>[\s\S]*?<\/a>/,
      )?.[0];
      expect(link?.match(/data-slot="status-badge"/g)).toHaveLength(1);
      expect(link).toContain(status);
      expect(link).toContain('열어 보기');
      expect(link).toContain('보완 요청 중 2건');
      if (deadline === null) {
        expect(link).not.toContain('D-1');
      } else {
        expect(link).toContain(deadline);
      }
    },
  );

  it('보완 요청 중인 서류가 있는 칸에만 그 건수를 함께 보인다', () => {
    const [personal, team] = matrixData.rows;
    const html = render({
      data: {
        ...matrixData,
        rows: [
          {
            ...personal,
            cells: personal.cells.map((item, index) =>
              index === 2 ? { ...item, changesRequestedCount: 2 } : item,
            ),
          },
          team,
        ],
      },
    });

    expect(html.match(/보완 요청 중 2건/g)).toHaveLength(1);
    expect(html).not.toContain('보완 요청 중 0건');
  });

  it('제출이 있는 셀만 reviewUrl로 링크하고 미제출 셀은 링크가 없다', () => {
    const html = render();

    const reviewLinks =
      html.match(/href="\/programs\/program-1\/submissions\//g) ?? [];
    expect(reviewLinks).toHaveLength(4);
    expect(html).toContain(
      '/programs/program-1/submissions/submission-approved/review',
    );
    expect(html).toContain(
      '/programs/program-1/submissions/submission-changes-requested/review',
    );
    expect(html.match(/>열어 보기</g)).toHaveLength(4);

    expect(html).toContain('v2');
  });

  it('제출된 셀에는 제출 시각을 표시한다', () => {
    const html = render();

    expect(html).toContain('08.19 10:00');
  });

  it('제출 시각과 revision을 가운뎃점 하나로 묶어 한 줄에 보여준다(#865)', () => {
    const html = render();

    expect(html).toContain('08.19 10:00 · v2');
  });

  it.each([
    ['APPROVED', '승인'],
    ['SUBMITTED', '검토 대기'],
  ] as const)('지각은 %s 배지 뒤의 태그로 붙는다', (status, label) => {
    const lateData: SubmissionMatrixPage = {
      ...matrixData,
      rows: matrixData.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) =>
          cell.status === status ? { ...cell, deliveryStatus: 'LATE' } : cell,
        ),
      })),
    };
    const html = render({ data: lateData });
    expect(html).toMatch(
      new RegExp(`>${label}</span><span[^>]*>· 지각</span>`),
    );
    expect(html).not.toContain('지각 제출');
  });

  it('모든 단계 보기에서만 현재 페이지 칸을 상태별로 센 통계를 보여준다', () => {
    const html = render();

    expect(html).toContain('단계별 상태');
    expect(html).toMatch(/기한 지남<\/dt><dd[^>]*>1<\/dd>/);
    expect(html).toMatch(/검토 대기<\/dt><dd[^>]*>1<\/dd>/);
    expect(html).toMatch(/보완 요청 중<\/dt><dd[^>]*>1<\/dd>/);
    expect(html).toMatch(/승인<\/dt><dd[^>]*>1<\/dd>/);
    expect(html).not.toContain('필수 서류 없음');
    expect(html).not.toContain('빠른 필터는');
    expect(html).not.toContain('이 페이지 2건(전체 2건) 중 2건 표시');

    expect(html).not.toContain('서류 칸');
    expect(html).not.toContain('빈 칸');
    expect(html).not.toContain('채움');
    expect(html).not.toContain('한 장도 안 낸 팀');
  });

  it('필수 서류 상태 빠른 필터를 팀 수와 함께 보여주고, 선택된 세그먼트만 aria-pressed된다(#619 스펙, #865)', () => {
    const chipFor = (html: string, label: string): string | null =>
      html
        .match(
          /<button[^>]*aria-pressed="(?:true|false)"[^>]*>[\s\S]*?<\/button>/g,
        )
        ?.find((candidate) => candidate.includes(label)) ?? null;
    const ariaPressedFor = (html: string, label: string): string | null =>
      chipFor(html, label)?.match(/aria-pressed="(true|false)"/)?.[1] ?? null;

    const html = render();

    expect(html).toContain('전체 2');
    expect(html).toContain('기한 지남 1');
    expect(html).toContain('보완 요청 중 1');
    expect(chipFor(html, '반려')).toBeNull();
    expect(chipFor(html, '승인')).toBeNull();
    expect(html).not.toContain('선택됨');

    for (const label of ['전체 2', '기한 지남 1', '보완 요청 중 1']) {
      expect(chipFor(html, label)).toContain('data-variant="toggle"');
    }

    expect(ariaPressedFor(html, '전체 2')).toBe('true');
    expect(ariaPressedFor(html, '기한 지남 1')).toBe('false');

    const hasEmptyHtml = render({ quickFilter: 'OVERDUE' });

    expect(ariaPressedFor(hasEmptyHtml, '전체 2')).toBe('false');
    expect(ariaPressedFor(hasEmptyHtml, '기한 지남 1')).toBe('true');
  });

  it('기한 지남 필터를 고르면 해당 행만 표를 채운다', () => {
    const html = render({ quickFilter: 'OVERDUE' });

    expect(html).not.toContain('홍길동 · 개인');
    expect(html).toContain('오픈소스팀(3)');
    expect(html).not.toContain('오픈소스팀(3) · 팀');
    expect(html).not.toContain('중 2건 표시');
  });

  it('여러 페이지에서는 전체 팀 수와 현재 페이지 범위를 구분한다', () => {
    const html = render({ data: { ...matrixData, total: 47 } });
    expect(html).toContain(
      '전체 47개 팀 중 2개를 표시합니다. 빠른 필터는 이 페이지에만 적용됩니다.',
    );
    expect(html).toContain('표를 좌우로 스크롤할 수 있습니다.');
    expect(html).not.toContain('중 2건 표시');
  });

  it('현재 페이지가 전체 결과와 같으면 페이지 안내 문구를 숨긴다', () => {
    const html = render({
      data: { ...matrixData, total: matrixData.rows.length },
    });
    expect(html).not.toContain('전체 2개 팀 중 2개를 표시합니다.');
    expect(html).not.toContain('빠른 필터는');
    expect(html).toContain('표를 좌우로 스크롤할 수 있습니다.');
  });

  it('고른 상태에 해당하는 팀이 없으면 빈 상태를 보여준다', () => {
    const html = render({ quickFilter: 'REJECTED' });

    expect(html).toContain('조건에 맞는 팀이 없습니다');
    expect(html).toContain('전체 보기');
    expect(html).not.toContain('홍길동 · 개인');
  });

  it('승인된 신청이 없으면 빈 상태를, 검색 결과가 없으면 필터 초기화를 안내한다', () => {
    const emptyData: SubmissionMatrixPage = {
      ...matrixData,
      rows: [],
      total: 0,
    };

    const noApplications = render({ data: emptyData, filterActive: false });
    const noResults = render({
      data: emptyData,
      filterActive: true,
      search: '없는팀',
    });

    expect(noApplications).toContain('참여 중인 신청이 없습니다');
    expect(noApplications).not.toContain('필터 초기화');
    expect(noResults).toContain('검색 결과가 없습니다');
    expect(noResults).toContain('필터 초기화');
  });

  it('마일스톤이 없으면 #101 프로그램 편집으로 추가를 안내한다', () => {
    const html = render({
      data: { milestones: [], rows: [], page: 1, pageSize: 20, total: 0 },
    });

    expect(html).toContain('마일스톤이 없습니다');
    expect(html).toContain('href="/programs/program-1/edit"');

    expect(html).toContain('>마일스톤 추가<');
    expect(html).not.toContain('프로그램 편집에서 마일스톤 추가');
  });

  it('전체 페이지가 2 이상일 때만 페이지네이션을 표시한다', () => {
    const paged = render({
      data: { ...matrixData, page: 2, total: 41 },
    });
    const single = render();

    expect(paged).toContain('제출 현황 페이지');
    expect(paged).toContain('2 / 3');
    expect(paged).toContain('이전');
    expect(paged).toContain('다음');
    expect(single).not.toContain('제출 현황 페이지');
  });

  it('로딩 중에는 매트릭스 대신 Skeleton을 표시한다', () => {
    const html = render({ isLoading: true, data: null });

    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('<table');
  });

  it('실패 시 Alert와 다시 시도를 표시한다', () => {
    const html = render({
      data: null,
      errorMessage: '제출 현황을 불러오지 못했습니다.',
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain('제출 현황을 불러오지 못했습니다.');
    expect(html).toContain('다시 시도');
  });

  it('검색 입력을 제공하고 형태(개인|팀) 필터 컨트롤은 두지 않는다', () => {
    const html = render();

    expect(html).toContain('신청자·팀명·GitHub ID');
    expect(html).not.toContain('id="matrix-mode"');
    expect(html).not.toContain('>개인</option>');
    expect(html).not.toContain('형태');
  });

  it('초기화 버튼은 필터가 걸려 있을 때만 나타난다(#865)', () => {
    const inactive = render();

    expect(inactive).not.toContain('>초기화<');

    const withSearch = render({ search: '홍길동' });

    expect(withSearch).toContain('>초기화<');

    const withQuickFilter = render({ quickFilter: 'OVERDUE' });

    expect(withQuickFilter).toContain('>초기화<');
  });
});

it('칸마다 다음 행동 상태 배지를 하나만 보여 준다', () => {
  const html = render();
  expect(html).toContain('>상태</p>');
  expect(html).not.toContain('제출 완료');
  const body = html.match(/<tbody[\s\S]*?<\/tbody>/)?.[0] ?? '';
  const rows = body.match(/<tr\b[\s\S]*?<\/tr>/g) ?? [];
  const cells = rows.flatMap((row) =>
    (row.match(/<td\b[\s\S]*?<\/td>/g) ?? []).slice(1),
  );
  expect(cells).toHaveLength(6);
  for (const cell of cells) {
    expect(cell.match(/data-slot="status-badge"/g)).toHaveLength(1);
  }
});
