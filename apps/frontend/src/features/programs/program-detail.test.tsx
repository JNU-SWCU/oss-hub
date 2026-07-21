import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActivityPanelBody } from './components/activity-graph-panel';
import { MilestoneRow } from './components/milestone-row';
import type { ProgramMilestone } from './types';

const milestone: ProgramMilestone = {
  id: 'milestone-1',
  name: '기획서 제출',
  dueAt: '2026-08-10T23:59:59+09:00',
  dDay: 5,
  deadlineLabel: 'D-5',
  description: 'PDF 기획서를 제출해 주세요.',
  submissionType: 'FILE',
  viewerSubmissionStatus: 'REJECTED',
  applicationSubmissionSummary: null,
};

describe('MilestoneRow', () => {
  it('비로그인에게 비공개 제출 상태 대신 로그인 안내를 표시한다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        milestone={{ ...milestone, viewerSubmissionStatus: null }}
        viewerRole={null}
        applicationStatus={null}
      />,
    );
    expect(html).toContain('기획서 제출');
    expect(html).toContain('D-5');
    expect(html).toContain('로그인 후 확인');
    expect(html).not.toContain('최종 반려');
  });

  it('학생에게 반려 상태를 색뿐 아니라 텍스트로 표시한다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        milestone={milestone}
        viewerRole="STUDENT"
        applicationStatus="APPROVED"
      />,
    );
    expect(html).toContain('최종 반려');
  });

  it('교직원에게 application 제출 요약과 전체 현황 진입을 표시한다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        milestone={{
          ...milestone,
          viewerSubmissionStatus: null,
          applicationSubmissionSummary: {
            notSubmitted: 2,
            submitted: 1,
            approved: 1,
            changesRequested: 1,
            rejected: 0,
            total: 5,
          },
        }}
        viewerRole="STAFF"
        applicationStatus={null}
      />,
    );
    expect(html).toContain('3/5');
    expect(html).toContain('전체 현황');
  });
});

describe('ActivityPanelBody', () => {
  it('저장소 없음과 부분 실패를 독립 상태로 표시한다', () => {
    const empty = renderToStaticMarkup(
      <ActivityPanelBody
        state={{ kind: 'ready', activities: [] }}
        onRetry={vi.fn()}
      />,
    );
    const failed = renderToStaticMarkup(
      <ActivityPanelBody state={{ kind: 'failed' }} onRetry={vi.fn()} />,
    );
    expect(empty).toContain('아직 연결된 저장소가 없습니다');
    expect(failed).toContain('활동을 불러오지 못했습니다');
    expect(failed).toContain('프로그램 정보는 정상적으로 표시');
  });
});
