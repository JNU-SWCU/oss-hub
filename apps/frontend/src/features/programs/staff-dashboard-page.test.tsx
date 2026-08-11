import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildStaffDashboardPageModel,
  StaffDashboardOverview,
  StaffDashboardPageView,
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
  it('한 화면에 프로그램별 신청, 활동, 제출 요약과 직접 링크를 렌더한다', () => {
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
    expect(html).toContain('/programs/program%3Abasic');
    expect(html).toContain('href="/programs/program%3Abasic/edit"');
    expect(html).toContain('aria-label="기본 프로그램 편집"');
    expect(html).toContain('after:absolute');
    expect(html).toContain('after:inset-0');
    expect(html).toContain('after:z-[1]');
    expect(html).toContain('/programs/program%3Abasic#activity');
    expect(html).toContain('/programs/program%3Abasic/applicants');
    expect(html).toContain('/programs/program%3Abasic/status');
  });

  it('저장소 없음, 수집 기준 없음, 미제출, 마일스톤 없음 상태를 분리해 표시한다', () => {
    const html = renderToStaticMarkup(
      <StaffDashboardOverview programs={summary.programs} now={now} />,
    );
    expect(html).toContain('연결된 저장소가 없습니다.');
    expect(html).toContain('수집된 활동 기준 시점이 없습니다.');
    expect(html).toContain('제출된 항목이 없습니다.');
    expect(html).toContain('등록된 마일스톤이 없습니다.');
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
      onSendDeadlineDigest: vi.fn(),
      isSendingDeadlineDigest: false,
      deadlineDigestNotice: null,
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
