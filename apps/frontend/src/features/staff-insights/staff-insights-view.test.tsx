import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { STAFF_INSIGHTS_FIXTURE } from './fixtures';
import { StaffInsightsView } from './staff-insights-view';
import { INSIGHTS_CUTS } from './types';

describe('StaffInsightsView', () => {
  it('groups period and comparison controls separately', () => {
    const html = renderToStaticMarkup(
      <StaffInsightsView
        state={{
          kind: 'ready',
          summary: STAFF_INSIGHTS_FIXTURE,
          cut: INSIGHTS_CUTS.COHORT,
          onCutChange: () => {},
        }}
      />,
    );
    expect(html).toContain('기간');
    expect(html).toContain('비교 관점');
    expect(html.match(/role="group"/g)).toHaveLength(2);
    expect(html).toContain('aria-labelledby="insights-period-label"');
    expect(html).toContain('id="insights-period-label"');
    expect(html).toContain('aria-labelledby="insights-cut-label"');
    expect(html).toContain('id="insights-cut-label"');
  });

  it('marks the current year with the chip toggle surface instead of the primary action colour', () => {
    const html = renderToStaticMarkup(
      <StaffInsightsView
        state={{
          kind: 'ready',
          summary: STAFF_INSIGHTS_FIXTURE,
          cut: INSIGHTS_CUTS.COHORT,
          onCutChange: () => {},
        }}
      />,
    );
    const start = html.indexOf('aria-label="필터"');
    const filters = html.slice(start, html.indexOf('</section>', start));

    // 지금 보는 해는 여전히 링크이고(R-31), 눌림은 옆 칩과 같은 toggle 표면으로 말한다.
    const currentYear = filters.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0];
    expect(currentYear).toBeDefined();
    expect(currentYear).toContain('data-variant="toggle"');
    expect(currentYear).toContain('href=');
    // toggle 표면이 「지금 보는 곳」도 채운다 — 이 선언이 빠지면 지금 보는 해가 빈 칩이 된다.
    expect(currentYear).toContain('aria-[current=page]:bg-secondary');

    // 필터 줄 안에 주 행동 색(채운 남색)으로 칠한 것이 없다.
    expect(filters).not.toContain('data-variant="default"');
  });

  it('shows cohort KPIs and ranking comparison copy', () => {
    const html = renderToStaticMarkup(
      <StaffInsightsView
        state={{
          kind: 'ready',
          summary: STAFF_INSIGHTS_FIXTURE,
          cut: INSIGHTS_CUTS.COHORT,
          onCutChange: () => {},
        }}
      />,
    );
    expect(html).toContain('학생 활성');
    expect(html).toContain('SW전공');
    expect(html).toContain('비SW전공');
    expect(html).toContain('활성 — 랭킹 지표');
    expect(html).toContain('참여 — 프로그램별');
    expect(html).toContain('합성 기초 오픈소스 스터디');
    expect(html).toContain('SW 활동 학생 / SW 가입 학생:');
    expect(html).toContain('31/42');
    expect(html).toContain('학과 미등록');
    expect(html).toContain('<table');
    expect(html).toContain('SW전공과 비SW전공의 랭킹 지표');
    expect(html).toContain('참여 — 프로그램별');
  });

  it('shows department rows when the department cut is selected', () => {
    const html = renderToStaticMarkup(
      <StaffInsightsView
        state={{
          kind: 'ready',
          summary: STAFF_INSIGHTS_FIXTURE,
          cut: INSIGHTS_CUTS.DEPARTMENT,
          onCutChange: () => {},
        }}
      />,
    );
    expect(html).toContain('전자컴퓨터공학부(컴퓨터공학전공)');
    expect(html).toContain('학과별 활성');
    expect(html).toContain('현재 프로필에 등록된 학과별로');
  });
});
