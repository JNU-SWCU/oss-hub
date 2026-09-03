import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildStaffDashboardPageModel,
  StaffDashboardOverview,
  StaffDashboardPageView,
  StaffDashboardStatusSummary,
} from './staff-dashboard-page';
import { parseStaffDashboardSummary } from './staff-dashboard-parser';
import {
  staffDashboardNow as now,
  staffDashboardSummary as summary,
} from './staff-dashboard-test-fixtures';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<'a'> & { readonly href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const [fixtureProgram] = summary.programs;
if (fixtureProgram === undefined) {
  throw new Error('Expected the staff dashboard fixture to include a program.');
}

describe('staff dashboard parser and model', () => {
  it('신청, 활동, 제출 요약이 있는 응답만 허용한다', () => {
    expect(parseStaffDashboardSummary(summary)).toEqual(summary);
    expect(() =>
      parseStaffDashboardSummary({
        programs: [
          {
            ...fixtureProgram,
            applications: {
              total: 3,
              submitted: 1,
              pendingApproval: 0,
              approved: 1,
              rejected: 1,
            },
          },
        ],
      }),
    ).toThrow('운영 대시보드 응답 형식이 올바르지 않습니다.');
    expect(() =>
      parseStaffDashboardSummary({
        programs: [
          {
            ...fixtureProgram,
            submissions: {
              ...fixtureProgram.submissions,
              total: 99,
            },
          },
        ],
      }),
    ).toThrow('운영 대시보드 응답 형식이 올바르지 않습니다.');
  });

  it('종료일과 게시 축이 빠진 응답을 형식 오류로 끊는다', () => {
    // 두 값이 없으면 화면이 조용히 「안 내린, 안 끝난 프로그램」으로 읽어
    // 끝난 프로그램에 「진행중」 배지를 단다(#1093).
    const { endAt: _endAt, ...withoutEndAt } = fixtureProgram;
    const { lifecycle: _lifecycle, ...withoutLifecycle } = fixtureProgram;

    expect(() =>
      parseStaffDashboardSummary({ programs: [withoutEndAt] }),
    ).toThrow('운영 대시보드 응답 형식이 올바르지 않습니다.');
    expect(() =>
      parseStaffDashboardSummary({ programs: [withoutLifecycle] }),
    ).toThrow('운영 대시보드 응답 형식이 올바르지 않습니다.');
    expect(() =>
      parseStaffDashboardSummary({
        programs: [{ ...fixtureProgram, lifecycle: 'DRAFT' }],
      }),
    ).toThrow('운영 대시보드 응답 형식이 올바르지 않습니다.');
  });

  it('빈 목록과 검색 결과 없음을 구분한다', () => {
    const empty = buildStaffDashboardPageModel({
      programs: [],
      search: '',
      status: 'all',
      page: 1,
      now,
    });
    const noResults = buildStaffDashboardPageModel({
      programs: summary.programs,
      search: '없는이름',
      status: 'all',
      page: 1,
      now,
    });
    expect(empty.isEmptyCatalog).toBe(true);
    expect(empty.isNoResults).toBe(false);
    expect(noResults.isEmptyCatalog).toBe(false);
    expect(noResults.isNoResults).toBe(true);
  });
});

describe('StaffDashboardOverview', () => {
  it('한 화면에 프로그램별 신청, 활동, 제출 요약과 편집 진입을 렌더한다', () => {
    const html = renderToStaticMarkup(
      <StaffDashboardOverview
        programs={summary.programs.slice(0, 1)}
        totalPrograms={summary.programs.length}
        now={now}
      />,
    );
    expect(html).toContain('기본 프로그램');
    expect(html).toContain('승인 대기');
    expect(html).toContain('저장소');
    expect(html).toContain('검토 대기');
    expect(html).toContain('href="/programs/program%3Abasic/edit"');
    expect(html).toContain('aria-label="기본 프로그램 편집"');
    expect(html).toContain('after:absolute');
    expect(html).toContain('after:inset-0');
    expect(html).toContain('after:z-[1]');
    expect(html).toContain('text-status-pending-fg');
    expect(html).toContain('text-status-rejected-fg');
    expect(html).toContain('justify-between');
    expect(html).not.toContain('grid-cols-2');
    expect(html).not.toContain('바로가기');
    expect(html).not.toContain('활동 상세');
    expect(html).not.toContain('제출 현황');
    expect(html).not.toContain('/programs/program%3Abasic#activity');
    expect(html).not.toContain('/programs/program%3Abasic/applicants');
    expect(html).not.toContain('/programs/program%3Abasic/status');
  });

  it('저장소 없음, 수집 전, 마일스톤 없음을 짧은 한 줄로 분리해 표시한다', () => {
    const html = renderToStaticMarkup(
      <StaffDashboardOverview programs={summary.programs} now={now} />,
    );
    expect(html).toContain('저장소 없음');
    expect(html).toContain('수집 전');
    expect(html).toContain('마일스톤 없음');
    expect(html).not.toContain('연결된 저장소가 없습니다.');
    expect(html).not.toContain('수집된 활동 기준 시점이 없습니다.');
    expect(html).not.toContain('제출된 항목이 없습니다.');
    expect(html).not.toContain('등록된 마일스톤이 없습니다.');
    expect(html).not.toContain('데이터 기준');
  });
});

describe('StaffDashboardStatusSummary', () => {
  it('모집중 → 진행중 → 종료 순서로 세 장만 세우고 내림은 종료 카드에 붙인다', () => {
    const html = renderToStaticMarkup(
      <StaffDashboardStatusSummary
        summary={{ recruiting: 2, inProgress: 1, ended: 3, archived: 1 }}
      />,
    );

    // 넷째 카드를 만들지 않는다 — 내림은 종료의 부분집합이라 따로 세우면 합이
    // 맞지 않는 것처럼 읽힌다.
    expect(html.match(/data-slot="card"/g)).toHaveLength(3);
    expect(html.indexOf('모집중')).toBeLessThan(html.indexOf('진행중'));
    expect(html.indexOf('진행중')).toBeLessThan(html.indexOf('>종료<'));
    expect(html).toContain('그중 내림 1개');
  });

  it('내림이 없어도 종료 카드는 0개로 말한다', () => {
    const html = renderToStaticMarkup(
      <StaffDashboardStatusSummary
        summary={{ recruiting: 0, inProgress: 0, ended: 0, archived: 0 }}
      />,
    );

    expect(html).toContain('그중 내림 0개');
  });
});

describe('StaffDashboardPageView', () => {
  it('전역 마감 알림 즉시 발송 액션을 렌더하지 않는다', () => {
    const html = renderToStaticMarkup(
      <StaffDashboardPageView
        state={{
          kind: 'ready',
          model: buildStaffDashboardPageModel({
            programs: summary.programs,
            search: '',
            status: 'all',
            page: 1,
            now,
          }),
          search: '',
          status: 'all',
          now,
          actions: {
            onSearchChange: vi.fn(),
            onStatusChange: vi.fn(),
            onSubmit: vi.fn(),
            onResetFilters: vi.fn(),
            onPageChange: vi.fn(),
          },
        }}
      />,
    );

    expect(html).not.toContain('마감 알림 지금 발송');
    expect(html).not.toContain('deadline-digests/send');
  });

  it('검색 결과 없음과 빈 프로그램 목록 상태를 별도로 렌더한다', () => {
    const actions = {
      onSearchChange: vi.fn(),
      onStatusChange: vi.fn(),
      onSubmit: vi.fn(),
      onResetFilters: vi.fn(),
      onPageChange: vi.fn(),
    };
    const emptyHtml = renderToStaticMarkup(
      <StaffDashboardPageView
        state={{
          kind: 'ready',
          model: buildStaffDashboardPageModel({
            programs: [],
            search: '',
            status: 'all',
            page: 1,
            now,
          }),
          search: '',
          status: 'all',
          now,
          actions,
        }}
      />,
    );
    const noResultsHtml = renderToStaticMarkup(
      <StaffDashboardPageView
        state={{
          kind: 'ready',
          model: buildStaffDashboardPageModel({
            programs: summary.programs,
            search: '없는이름',
            status: 'all',
            page: 1,
            now,
          }),
          search: '없는이름',
          status: 'all',
          now,
          actions,
        }}
      />,
    );
    expect(emptyHtml).toContain('등록된 프로그램이 없습니다');
    expect(emptyHtml).not.toContain('검색 결과가 없습니다');
    expect(noResultsHtml).toContain('검색 결과가 없습니다');
    expect(noResultsHtml).not.toContain('등록된 프로그램이 없습니다');
  });
});
