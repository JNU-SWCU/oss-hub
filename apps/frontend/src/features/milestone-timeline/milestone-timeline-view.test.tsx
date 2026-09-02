import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MilestoneTimelineView } from './components/milestone-timeline-view';
import {
  loadMilestoneTimeline,
  parseMilestoneTimelineResponse,
} from './loader';
import { NOW, PROGRAM_ID, response } from './milestone-timeline.test-fixtures';

const apiClientMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  apiClient: apiClientMock,
}));

describe('milestone timeline loader and view', () => {
  afterEach(() => {
    apiClientMock.mockReset();
  });

  it('loadMilestoneTimeline은 #116 checklist endpoint를 호출하고 파싱한다', async () => {
    // Given
    apiClientMock.mockResolvedValue(response);

    // When
    const timeline = await loadMilestoneTimeline({ programId: PROGRAM_ID });

    // Then
    expect(apiClientMock).toHaveBeenCalledWith(
      'programs/program-1/submissions/me',
    );
    expect(timeline.items.map((item) => item.milestoneId)).toEqual([
      'overdue',
      'text',
      'file',
      'summary',
      'rejected',
      'missing',
      'text-missing',
      'changes-locked',
    ]);
  });

  it('상위 경로로 정규화되는 programId는 API 요청 전에 거부한다', async () => {
    await expect(loadMilestoneTimeline({ programId: '..' })).rejects.toThrow(
      '마일스톤 타임라인 경로가 올바르지 않습니다',
    );
    expect(apiClientMock).not.toHaveBeenCalled();
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
    expect(readyHtml).toContain('파일 제출 준비 중');
    expect(readyHtml.match(/파일 제출 준비 중/g)).toHaveLength(2);
    expect(readyHtml).toMatch(
      /<button[^>]*disabled[^>]*>파일 제출 준비 중<\/button>/,
    );
    expect(readyHtml).toContain(
      'href="/programs/program-1/documents?milestoneId=text-missing"',
    );
    expect(readyHtml).toContain(
      'href="/programs/program-1/documents?milestoneId=text"',
    );
    expect(readyHtml).not.toContain(
      'href="/programs/program-1/documents?milestoneId=missing"',
    );
    expect(readyHtml).not.toContain(
      'href="/programs/program-1/documents?milestoneId=file"',
    );
    expect(readyHtml).not.toContain(
      'href="/programs/program-1/documents?milestoneId=overdue"',
    );
    expect(loadingHtml).toContain('마일스톤 타임라인을 불러오는 중');
    expect(emptyHtml).toContain('등록된 마일스톤이 없습니다');
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('다시 시도');
  });
});
