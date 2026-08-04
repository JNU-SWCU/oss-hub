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

  it('제출된 셀에는 제출 시각을 표시한다', () => {
    // Given / When — 모든 제출 셀의 submittedAt은 픽스처상 2026-08-19T10:00:00+09:00.
    const html = render();

    // Then
    expect(html).toContain('08.19 10:00');
  });

  it('마감(dueAt) 이후 제출된 셀은 "지각" 배지를 덧붙인다', () => {
    // Given — 기획서 마감은 09/10, 픽스처 submittedAt은 08/19(마감 전) → 지각 아님.
    const html = render();
    expect(html).not.toContain('>지각<');

    // When — 마감을 제출 시각보다 이전으로 옮겨 지각 상태를 만든다.
    const lateData: SubmissionMatrixPage = {
      ...matrixData,
      milestones: matrixData.milestones.map((milestone) =>
        milestone.id === 'milestones-overdue'
          ? { ...milestone, dueAt: '2026-08-01T00:00:00+09:00' }
          : milestone,
      ),
    };
    const lateHtml = render({ data: lateData });

    // Then
    expect(lateHtml).toContain('>지각<');
  });

  it('현재 페이지 로드분을 기준으로 서류 칸 요약 4종을 보여준다', () => {
    // Given / When
    const html = render();

    // Then — 6칸(2행×3열) 중 4칸 채움, 2칸 빈 칸, 미제출 팀 0, 지각 0.
    expect(html).toContain('서류 칸');
    expect(html).toContain('4/6 채움');
    expect(html).toContain('빈 칸');
    expect(html).toContain('2개');
    expect(html).toContain('한 장도 안 낸 팀');
    expect(html).toContain('지각 제출');
    expect(html).toContain('이 페이지 2건(전체 2건) 중 2건 표시');
  });

  it('3버튼 빠른 필터를 팀 수와 함께 보여준다(#619 스펙)', () => {
    // Given / When — 픽스처: 팀 행(오픈소스팀)은 빈 칸 있음, 한 장도 안 낸 행은 없음.
    const html = render();

    // Then
    expect(html).toContain('전체 2팀');
    expect(html).toContain('빈 칸 있는 팀 2');
    expect(html).toContain('한 장도 안 낸 팀 0');
  });

  it('빈 칸 있는 팀 필터를 고르면 해당 행만 표를 채운다', () => {
    // Given — 개인 행은 최종 제출 미제출, 팀 행은 중간 보고 미제출 → 둘 다 빈 칸 있음.
    const html = render({ quickFilter: 'HAS_EMPTY' });

    // Then
    expect(html).toContain('홍길동 · 개인');
    expect(html).toContain('오픈소스팀(3) · 팀');
    expect(html).toContain('중 2건 표시');
  });

  it('한 장도 안 낸 팀 필터는 전부 미제출인 행만 남기고 빈 상태를 보여준다', () => {
    // Given — 픽스처 두 행 모두 제출이 하나 이상 있어 "한 장도 안 낸 팀"은 0.
    const html = render({ quickFilter: 'ZERO_SUBMISSION' });

    // Then
    expect(html).toContain('조건에 맞는 팀이 없습니다');
    expect(html).toContain('전체 보기');
    expect(html).not.toContain('홍길동 · 개인');
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

  it('검색 입력을 제공하고 형태(개인|팀) 필터 컨트롤은 두지 않는다', () => {
    // Given / When
    const html = render();

    // Then
    expect(html).toContain('신청자·팀명·GitHub ID');
    expect(html).not.toContain('id="matrix-mode"');
    expect(html).not.toContain('>개인</option>');
    expect(html).not.toContain('형태');
  });
});
