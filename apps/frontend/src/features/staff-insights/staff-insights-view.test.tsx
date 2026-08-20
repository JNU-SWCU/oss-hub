import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { STAFF_INSIGHTS_FIXTURE } from './fixtures';
import { StaffInsightsView } from './staff-insights-view';
import { INSIGHTS_CUTS } from './types';

describe('StaffInsightsView', () => {
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
