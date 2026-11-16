import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { STAFF_INSIGHTS_FIXTURE } from './fixtures';
import { StaffInsightsView } from './staff-insights-view';
import type { InsightsView } from './types';

function render(view: InsightsView): string {
  return renderToStaticMarkup(
    <StaffInsightsView
      state={{ kind: 'ready', summary: STAFF_INSIGHTS_FIXTURE, view }}
    />,
  );
}

function tabBar(html: string): string {
  const start = html.indexOf('aria-label="인사이트 보기"');
  return html.slice(start, html.indexOf('</div>', start));
}

describe('StaffInsightsView', () => {
  it('shows the 인사이트 header, period group and three view tabs', () => {
    const html = render('students');
    expect(html).toContain('인사이트');
    expect(html).toContain('기간');
    expect(html).toContain('aria-labelledby="insights-period-label"');
    expect(html).not.toContain('비교 관점');
    expect(html).not.toContain('학생 활성');
    const tabs = tabBar(html);
    expect(tabs.match(/<a /g)).toHaveLength(3);
    expect(tabs).toContain('>학생</a>');
    expect(tabs).toContain('>학과·전공</a>');
    expect(tabs).toContain('>프로그램</a>');
  });

  it('marks the current tab and keeps the year in tab links', () => {
    const html = render('groups');
    const current = tabBar(html).match(/<a[^>]*aria-current="page"[^>]*>/g);
    expect(current).toHaveLength(1);
    expect(current?.[0]).toContain('data-variant="toggle"');
    expect(current?.[0]).toContain('href="/dashboard/insights?view=groups"');
    expect(tabBar(html)).toContain('href="/dashboard/insights"');
  });

  it('marks the current year with the chip toggle surface and keeps the view in year links', () => {
    const html = render('programs');
    const start = html.indexOf('aria-label="필터"');
    const filters = html.slice(start, html.indexOf('</section>', start));

    const currentYear = filters.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0];
    expect(currentYear).toBeDefined();
    expect(currentYear).toContain('data-variant="toggle"');
    expect(currentYear).toContain('aria-[current=page]:bg-secondary');
    expect(filters).toContain('view=programs');
    expect(filters).not.toContain('data-variant="default"');
  });

  it('shows the period and recent top-10 cards on the students tab', () => {
    const html = render('students');
    expect(html).not.toContain('학생 순위를 준비 중입니다');
    expect(html).toContain('aria-label="학생 구분"');
    expect(html).toContain('기간 전체 상위 10명');
    expect(html).toContain('최근 30일 상위 10명');
    expect(html).toContain('합성 학생 가');
    expect(html).not.toContain('프로그램 참여 순위');
  });

  it('shows cohort KPI tiles and the department ranking on the groups tab', () => {
    const html = render('groups');
    expect(html).toContain('aria-label="전공별 지표"');
    expect(html).toContain('SW전공 활동률');
    expect(html).toContain('31/42');
    expect(html).toContain('비SW전공 프로그램 참여율');
    expect(html).toContain('학과 미등록');
    expect(html).toContain('학과 순위');
    expect(html).toContain('aria-label="학과 순위 기준"');
    expect(html).toContain('<caption>학과 순위 (가입 학생 수 기준)</caption>');
    expect(html).toContain('전자컴퓨터공학부(컴퓨터공학전공)');
    expect(html).not.toContain('활성 — 랭킹 지표');
    expect(html).not.toContain('학과별 활성');
    expect(html).not.toContain('프로그램 참여 순위');
  });

  it('shows ranked program participation on the programs tab', () => {
    const html = render('programs');
    expect(html).toContain('프로그램 참여 순위');
    expect(html).toContain('기간 필터는 적용되지 않습니다.');
    expect(html).toContain('학과 미등록');
    expect(html).not.toContain('활성 — 랭킹 지표');
    const table = html.slice(html.indexOf('<table>'), html.indexOf('</table>'));
    expect(table).toContain('<th>순위</th>');
    const rows = Array.from(
      table.matchAll(/<tr><td>(\d+)<\/td><td>([^<]+)<\/td>/g),
      ([, rank, name]) => [rank, name],
    );
    expect(rows).toEqual([
      ['1', '합성 기초 오픈소스 스터디'],
      ['2', '합성 캡스톤 2026'],
    ]);
  });

  it('keeps the programs empty state when no participation is approved', () => {
    const html = renderToStaticMarkup(
      <StaffInsightsView
        state={{
          kind: 'ready',
          summary: { ...STAFF_INSIGHTS_FIXTURE, programs: [] },
          view: 'programs',
        }}
      />,
    );
    expect(html).toContain('승인된 참여가 없습니다');
    expect(html).not.toContain('<table>');
  });
});
