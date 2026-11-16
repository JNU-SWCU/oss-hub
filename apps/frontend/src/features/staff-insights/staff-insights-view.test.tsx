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

  it('shows the interim students placeholder on the students tab', () => {
    const html = render('students');
    expect(html).toContain('학생 순위를 준비 중입니다');
    expect(html).not.toContain('참여 — 프로그램별');
  });

  it('shows cohort KPIs, activity and departments on the groups tab', () => {
    const html = render('groups');
    expect(html).toContain('SW 활동 학생 / SW 가입 학생:');
    expect(html).toContain('31/42');
    expect(html).toContain('학과 미등록');
    expect(html).toContain('활성 — 랭킹 지표');
    expect(html).toContain('SW전공과 비SW전공의 랭킹 지표');
    expect(html).toContain('전자컴퓨터공학부(컴퓨터공학전공)');
    expect(html).toContain('학과별 활성');
    expect(html).not.toContain('참여 — 프로그램별');
  });

  it('shows program participation on the programs tab', () => {
    const html = render('programs');
    expect(html).toContain('참여 — 프로그램별');
    expect(html).toContain('합성 기초 오픈소스 스터디');
    expect(html).not.toContain('활성 — 랭킹 지표');
  });
});
