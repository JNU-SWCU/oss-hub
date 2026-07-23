import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { MilestoneTimelineView } from './components/milestone-timeline-view';
import {
  loadMilestoneTimeline,
  parseMilestoneTimelineResponse,
} from './loader';

const NOW = new Date('2026-07-24T09:00:00+09:00');
const PROGRAM_ID = 'program-1';

function submission(status: string) {
  return {
    id: `submission-${status}`,
    status,
    currentRevision: 2,
    lastReviewedAt: status === 'SUBMITTED' ? null : '2026-07-23T12:00:00+09:00',
    reviewComment: status === 'CHANGES_REQUESTED' ? '보완해 주세요.' : null,
    canResubmit: status === 'CHANGES_REQUESTED',
  };
}

const response = {
  applicationId: 'application-1',
  applicationMode: 'TEAM',
  items: [
    {
      milestoneId: 'release',
      name: '릴리스 제출',
      dueAt: '2026-08-03T23:59:59+09:00',
      submissionType: 'REPOSITORY_RELEASE',
      submission: submission('APPROVED'),
    },
    {
      milestoneId: 'text',
      name: '아이디어 요약',
      dueAt: '2026-07-24T23:59:59+09:00',
      submissionType: 'TEXT',
      submission: submission('SUBMITTED'),
    },
    {
      milestoneId: 'file',
      name: '기획서',
      dueAt: '2026-07-30T23:59:59+09:00',
      submissionType: 'FILE',
      submission: submission('CHANGES_REQUESTED'),
    },
    {
      milestoneId: 'rejected',
      name: '최종 보고서',
      dueAt: '2026-08-10T23:59:59+09:00',
      submissionType: 'TEXT',
      submission: submission('REJECTED'),
    },
    {
      milestoneId: 'missing',
      name: '성과 공유',
      dueAt: '2026-08-20T23:59:59+09:00',
      submissionType: 'FILE',
      submission: null,
    },
  ],
};

describe('milestone timeline parser', () => {
  it('locked #116 checklist를 dueAt ASC, KST D-day와 제출 상태로 변환한다', () => {
    // Given / When
    const timeline = parseMilestoneTimelineResponse(response, PROGRAM_ID, NOW);

    // Then
    expect(timeline.applicationMode).toBe('TEAM');
    expect(timeline.items.map((item) => item.milestoneId)).toEqual([
      'text',
      'file',
      'release',
      'rejected',
      'missing',
    ]);
    expect(timeline.items.map((item) => item.dDayLabel)).toEqual([
      'D-Day',
      'D-6',
      'D-10',
      'D-17',
      'D-27',
    ]);
    expect(timeline.items.map((item) => item.statusLabel)).toEqual([
      'SUBMITTED',
      'CHANGES_REQUESTED',
      'APPROVED',
      'REJECTED',
      '미제출',
    ]);
    expect(
      timeline.items.find((item) => item.status === 'REJECTED')?.submission
        ?.canResubmit,
    ).toBe(false);
    expect(timeline.items[1]?.submissionGuide).toBe('PDF·HWP·이미지·압축 파일');
    expect(timeline.items[1]?.submitHref).toBe(
      '/programs/program-1/milestones/file/submit',
    );
  });

  it.each([
    ['applicationMode', { ...response, applicationMode: 'GROUP' }],
    [
      'currentRevision',
      {
        ...response,
        items: [
          {
            ...response.items[0],
            submission: {
              ...response.items[0]?.submission,
              currentRevision: 1.5,
            },
          },
        ],
      },
    ],
    [
      'nullable review fields',
      {
        ...response,
        items: [
          {
            ...response.items[0],
            submission: {
              ...response.items[0]?.submission,
              lastReviewedAt: 123,
            },
          },
        ],
      },
    ],
    [
      'canResubmit',
      {
        ...response,
        items: [
          {
            ...response.items[0],
            submission: {
              ...response.items[0]?.submission,
              canResubmit: 'yes',
            },
          },
        ],
      },
    ],
  ])('%s 계약 위반을 거부한다', (_field, malformed) => {
    // Given / When / Then
    expect(() =>
      parseMilestoneTimelineResponse(malformed, PROGRAM_ID, NOW),
    ).toThrow('마일스톤 타임라인 응답 형식이 올바르지 않습니다');
  });
});

describe('milestone timeline fixtures and view', () => {
  it('default fixture가 다섯 상태와 exact #116 metadata를 제공한다', async () => {
    // Given / When
    const timeline = await loadMilestoneTimeline({
      programId: PROGRAM_ID,
      fixture: null,
      attempt: 0,
      now: NOW,
    });

    // Then
    expect(timeline.items.map((item) => item.statusLabel)).toEqual([
      'SUBMITTED',
      'CHANGES_REQUESTED',
      'APPROVED',
      'REJECTED',
      '미제출',
    ]);
    expect(
      timeline.items.find((item) => item.status === 'REJECTED')?.submission
        ?.canResubmit,
    ).toBe(false);
  });

  it('empty와 error retry fixture를 지원한다', async () => {
    // Given / When
    const empty = await loadMilestoneTimeline({
      programId: PROGRAM_ID,
      fixture: 'empty',
      attempt: 0,
      now: NOW,
    });

    // Then
    expect(empty.items).toEqual([]);
    await expect(
      loadMilestoneTimeline({
        programId: PROGRAM_ID,
        fixture: 'error',
        attempt: 0,
        now: NOW,
      }),
    ).rejects.toThrow('마일스톤 타임라인을 불러오지 못했습니다');
    await expect(
      loadMilestoneTimeline({
        programId: PROGRAM_ID,
        fixture: 'error',
        attempt: 1,
        now: NOW,
      }),
    ).resolves.toMatchObject({ applicationMode: 'TEAM' });
  });

  it('responsive timeline과 loading, empty, error states를 렌더링한다', async () => {
    // Given
    const timeline = await loadMilestoneTimeline({
      programId: PROGRAM_ID,
      fixture: null,
      attempt: 0,
      now: NOW,
    });

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
    expect(readyHtml).toContain('팀 신청');
    expect(readyHtml).toContain('md:flex-row');
    expect(readyHtml).toContain('REPOSITORY_RELEASE');
    expect(readyHtml).toContain('PDF·HWP·이미지·압축 파일');
    expect(readyHtml).not.toContain('OSS 경진대회');
    expect(readyHtml.match(/제출하기/g)).toHaveLength(1);
    expect(readyHtml).toContain(
      'href="/programs/program-1/milestones/missing/submit"',
    );
    expect(readyHtml).not.toContain(
      'href="/programs/program-1/milestones/file/submit"',
    );
    expect(loadingHtml).toContain('마일스톤 타임라인을 불러오는 중');
    expect(emptyHtml).toContain('등록된 마일스톤이 없습니다');
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('다시 시도');
  });
});
