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
  });
});
