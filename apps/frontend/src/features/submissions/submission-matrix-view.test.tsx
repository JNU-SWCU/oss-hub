import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SubmissionMatrixView } from './components/submission-matrix-view';
import type { SubmissionMatrixViewProps } from './components/submission-matrix-view';
import type { MatrixCell, SubmissionMatrixPage } from './types';

// 합성 데이터 — #110 seed 시나리오 계약(개인/팀, 5개 상태, upcoming/overdue)을 따른다.
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
      submittedAt: null,
      reviewUrl: null,
    };
  }
  const submissionId = input.submissionId ?? 'submission-existing';
  return {
    milestoneId: input.milestoneId,
    submissionId,
    revision: input.revision ?? 1,
    status: input.status,
    submittedAt: '2026-08-19T10:00:00+09:00',
    reviewUrl: `/staff/programs/program-1/submissions/${submissionId}/review`,
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
      applicationId: 'application-personal',
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
      applicationId: 'application-team',
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
  onModeChange: vi.fn(),
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
      mode="ALL"
      filterActive={false}
      isLoading={false}
      errorMessage={null}
      now={NOW}
      {...handlers}
      {...overrides}
    />,
  );
}

describe('SubmissionMatrixView', () => {
  it('개인·팀 행을 같은 매트릭스에 표시하고 5개 상태 라벨을 구분한다', () => {
    // Given / When
    const html = render();

    // Then — 행: 개인은 이름, 팀은 팀명(인원), GitHub 핸들.
    expect(html).toContain('홍길동 · 개인');
    expect(html).toContain('오픈소스팀(3) · 팀');
    expect(html).toContain('@hong');
    expect(html).toContain('@login-a @login-b @login-c');
    // Then — 열: 마일스톤 이름 + Asia/Seoul 마감일.
    expect(html).toContain('기획서');
    expect(html).toContain('9월 10일 마감');
    // Then — 상태 5종은 기존 화면과 동일 문자열.
    expect(html).toContain('승인');
    expect(html).toContain('보완 필요');
    expect(html).toContain('제출됨');
    expect(html).toContain('최종 반려');
    expect(html).toContain('제출 전');
  });

  it('NOT_SUBMITTED 셀은 dueAt 파생 보조 표시(OVERDUE/D-n)를 붙인다', () => {
    // Given / When
    const html = render();

    // Then — 팀 행 중간 보고(9/12 마감, now 9/15) → OVERDUE D+3.
    expect(html).toContain('OVERDUE D+3');
    // Then — 개인 행 최종 제출(10/30 마감) → D-45.
    expect(html).toContain('D-45');
  });

  it('제출이 있는 셀만 reviewUrl로 링크하고 미제출 셀은 링크가 없다', () => {
    // Given / When
    const html = render();

    // Then — 제출 셀 4개만 #125 검토 링크.
    const reviewLinks =
      html.match(/href="\/staff\/programs\/program-1\/submissions\//g) ?? [];
    expect(reviewLinks).toHaveLength(4);
    expect(html).toContain(
      '/staff/programs/program-1/submissions/submission-approved/review',
    );
    expect(html).toContain(
      '/staff/programs/program-1/submissions/submission-changes-requested/review',
    );
    // Then — 최신 revision 표시.
    expect(html).toContain('v2');
  });

  it('승인된 신청이 없으면 빈 상태를, 검색 결과가 없으면 필터 초기화를 안내한다', () => {
    // Given
    const emptyData: SubmissionMatrixPage = {
      ...matrixData,
      rows: [],
      total: 0,
    };

    // When
    const noApplications = render({ data: emptyData, filterActive: false });
    const noResults = render({
      data: emptyData,
      filterActive: true,
      search: '없는팀',
    });

    // Then
    expect(noApplications).toContain('참여 중인 신청이 없습니다');
    expect(noApplications).not.toContain('필터 초기화');
    expect(noResults).toContain('검색 결과가 없습니다');
    expect(noResults).toContain('필터 초기화');
  });

  it('마일스톤이 없으면 #101 프로그램 편집으로 추가를 안내한다', () => {
    // Given / When
    const html = render({
      data: { milestones: [], rows: [], page: 1, pageSize: 20, total: 0 },
    });

    // Then
    expect(html).toContain('마일스톤이 없습니다');
    expect(html).toContain('href="/staff/programs/program-1/edit"');
  });

  it('전체 페이지가 2 이상일 때만 페이지네이션을 표시한다', () => {
    // Given / When
    const paged = render({
      data: { ...matrixData, page: 2, total: 41 },
    });
    const single = render();

    // Then
    expect(paged).toContain('제출 현황 페이지');
    expect(paged).toContain('2 / 3');
    expect(paged).toContain('이전');
    expect(paged).toContain('다음');
    expect(single).not.toContain('제출 현황 페이지');
  });

  it('로딩 중에는 매트릭스 대신 Skeleton을 표시한다', () => {
    // Given / When
    const html = render({ isLoading: true, data: null });

    // Then
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('<table');
  });

  it('실패 시 Alert와 다시 시도를 표시한다', () => {
    // Given / When
    const html = render({
      data: null,
      errorMessage: '제출 현황을 불러오지 못했습니다.',
    });

    // Then
    expect(html).toContain('role="alert"');
    expect(html).toContain('제출 현황을 불러오지 못했습니다.');
    expect(html).toContain('다시 시도');
  });

  it('검색 입력과 형태 필터(전체|개인|팀)를 제공한다', () => {
    // Given / When
    const html = render({ mode: 'TEAM' });

    // Then
    expect(html).toContain('신청자·팀명·GitHub ID');
    expect(html).toContain('>전체</option>');
    expect(html).toContain('>개인</option>');
    expect(html).toContain('>팀</option>');
    expect(html).toContain('selected=""');
  });
});
