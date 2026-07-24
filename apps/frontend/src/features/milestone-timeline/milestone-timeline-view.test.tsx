import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { MilestoneTimelineView } from './components/milestone-timeline-view';
import {
  loadMilestoneTimeline,
  parseMilestoneTimelineResponse,
} from './loader';
import { NOW, PROGRAM_ID, response } from './milestone-timeline.test-fixtures';

describe('milestone timeline loader and view', () => {
  it('production loader는 #116 endpoint 병합 전 synthetic data 대신 fail closed 한다', async () => {
    // Given / When / Then
    await expect(
      loadMilestoneTimeline({ programId: PROGRAM_ID }),
    ).rejects.toThrow('마일스톤 타임라인을 불러올 수 없습니다');
  });

  it('responsive timeline과 loading, empty, error states를 렌더링한다', () => {
    // Given
    const timeline = parseMilestoneTimelineResponse(response, PROGRAM_ID, NOW);

    // When
    const readyHtml = renderToStaticMarkup(
      <MilestoneTimelineView
        state={{ kind: 'ready', timeline }}
        onRetry={vi.fn()}
      />,
    );
    const loadingHtml = renderToStaticMarkup(
      <MilestoneTimelineView state={{ kind: 'loading' }} onRetry={vi.fn()} />,
    );
    const emptyHtml = renderToStaticMarkup(
      <MilestoneTimelineView
        state={{
          kind: 'ready',
          timeline: { ...timeline, items: [] },
        }}
        onRetry={vi.fn()}
      />,
    );
    const errorHtml = renderToStaticMarkup(
      <MilestoneTimelineView state={{ kind: 'error' }} onRetry={vi.fn()} />,
    );

    // Then
    expect(readyHtml).toContain('마일스톤 타임라인');
    expect(readyHtml).toContain('PDF·HWP·이미지·압축 파일');
    expect(readyHtml).toMatch(/data-variant="rejected"[^>]*>보완 필요/);
    expect(readyHtml.match(/제출하기/g)).toHaveLength(1);
    expect(readyHtml).toContain('다시 제출');
    expect(readyHtml).toContain(
      'href="/programs/program-1/milestones/missing/submit"',
    );
    expect(readyHtml).toContain(
      'href="/programs/program-1/submissions?milestoneId=file"',
    );
    expect(readyHtml).not.toContain(
      'href="/programs/program-1/milestones/overdue/submit"',
    );
    expect(loadingHtml).toContain('마일스톤 타임라인을 불러오는 중');
    expect(emptyHtml).toContain('등록된 마일스톤이 없습니다');
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('다시 시도');
  });
});
