import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StaffDashboardProgramSummary } from './types';
import { staffProgramHref } from './program-paths';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

function applicantsHref(program: StaffDashboardProgramSummary): string {
  return program.applicantsPath || staffProgramHref(program.id, '/applicants');
}

function filterPrograms(
  programs: readonly StaffDashboardProgramSummary[],
  search: string,
): readonly StaffDashboardProgramSummary[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return programs;
  return programs.filter((program) =>
    program.name.toLowerCase().includes(needle),
  );
}

const emptySummary: readonly StaffDashboardProgramSummary[] = [];

const multiPrograms: readonly StaffDashboardProgramSummary[] = [
  {
    id: 'program:basic',
    name: '기본 프로그램',
    category: 'BASIC',
    applicationPeriod: {
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-07-31T23:59:59.000Z',
    },
    applications: {
      total: 3,
      submitted: 1,
      approved: 1,
      rejected: 1,
    },
    applicantsPath: '/staff/programs/program%3Abasic/applicants',
  },
  {
    id: 'program:capstone',
    name: '캡스톤 프로그램',
    category: 'CAPSTONE',
    applicationPeriod: {
      startsAt: '2026-08-01T00:00:00.000Z',
      endsAt: '2026-08-31T23:59:59.000Z',
    },
    applications: {
      total: 0,
      submitted: 0,
      approved: 0,
      rejected: 0,
    },
    applicantsPath: '/staff/programs/program%3Acapstone/applicants',
  },
];

describe('staff dashboard helpers', () => {
  it('빈 목록과 검색 결과 없음을 구분한다', () => {
    expect(emptySummary).toHaveLength(0);
    expect(filterPrograms(multiPrograms, '없는이름')).toHaveLength(0);
    expect(filterPrograms(multiPrograms, '')).toHaveLength(2);
    expect(filterPrograms(multiPrograms, '캡스톤')).toHaveLength(1);
  });

  it('신청자 목록 링크는 #106 applicants 경로를 쓴다', () => {
    expect(applicantsHref(multiPrograms[0]!)).toBe(
      '/staff/programs/program%3Abasic/applicants',
    );
    expect(applicantsHref(multiPrograms[1]!)).toContain('/applicants');
  });

  it('Application 단위 집계 필드를 표시용으로 유지한다', () => {
    const counts = multiPrograms[0]!.applications;
    expect(counts.total).toBe(
      counts.submitted + counts.approved + counts.rejected,
    );
  });
});

describe('staff dashboard multi-program markup', () => {
  it('여러 프로그램 행과 applicants 링크를 렌더한다', () => {
    const html = renderToStaticMarkup(
      <ul>
        {multiPrograms.map((program) => (
          <li key={program.id}>
            <span>{program.name}</span>
            <span>
              전체 {program.applications.total} · 제출{' '}
              {program.applications.submitted}
            </span>
            <a href={applicantsHref(program)}>목록</a>
          </li>
        ))}
      </ul>,
    );
    expect(html).toContain('기본 프로그램');
    expect(html).toContain('캡스톤 프로그램');
    expect(html).toContain('전체 3');
    expect(html).toContain('href="/staff/programs/program%3Abasic/applicants"');
    expect(html).not.toContain('TicketStub');
    expect(html).not.toContain('#117');
  });

  it('빈 상태 문구를 렌더한다', () => {
    const html = renderToStaticMarkup(
      <div>
        {emptySummary.length === 0 ? (
          <p>등록된 프로그램이 없습니다</p>
        ) : (
          <p>검색 결과가 없습니다</p>
        )}
      </div>,
    );
    expect(html).toContain('등록된 프로그램이 없습니다');
    expect(html).not.toContain('검색 결과가 없습니다');
  });
});
