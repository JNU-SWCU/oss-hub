import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { MilestoneTimelineView } from './components/milestone-timeline-view';
import {
  loadMilestoneTimeline,
  parseMilestoneTimelineResponse,
} from './loader';
import type { SubmittedStatus } from './types';

const NOW = new Date('2026-07-24T09:00:00+09:00');
const PROGRAM_ID = 'program-1';

function submission(
  status: SubmittedStatus,
  options: {
    readonly canResubmit?: boolean;
    readonly includeMetadata?: boolean;
  } = {},
) {
  const includeMetadata = options.includeMetadata ?? true;
  return {
    id: `submission-${status}`,
    status,
    currentRevision: 2,
    ...(includeMetadata
      ? {
          lastReviewedAt:
            status === 'SUBMITTED' ? null : '2026-07-23T12:00:00+09:00',
          reviewComment:
            status === 'CHANGES_REQUESTED' ? '보완해 주세요.' : null,
        }
      : {}),
    canResubmit: options.canResubmit ?? status === 'CHANGES_REQUESTED',
  };
}

const response = {
  applicationId: 'application-1',
  applicationMode: 'TEAM',
  items: [
    {
      milestoneId: 'release',
      name: '릴리즈 제출',
      dueAt: '2026-08-03T23:59:59+09:00',
      submissionType: 'REPOSITORY_RELEASE',
      submission: submission('APPROVED'),
    },
    {
      milestoneId: 'text',
      name: '아이디어 요약',
      dueAt: '2026-07-24T23:59:59+09:00',
      submissionType: 'TEXT',
      submission: submission('SUBMITTED', { includeMetadata: false }),
    },
    {
      milestoneId: 'file',
      name: '기획안',
      dueAt: '2026-07-30T23:59:59+09:00',
      submissionType: 'FILE',
      submission: submission('CHANGES_REQUESTED'),
    },
    {
      milestoneId: 'rejected',
      name: '최종 보고서',
      dueAt: '2026-08-10T23:59:59+09:00',
      submissionType: 'TEXT',
      submission: submission('REJECTED', { canResubmit: false }),
    },
    {
      milestoneId: 'missing',
      name: '성과 공유',
      dueAt: '2026-08-20T23:59:59+09:00',
      submissionType: 'FILE',
      submission: null,
    },
    {
      milestoneId: 'overdue',
      name: '마감 지난 제출',
      dueAt: '2026-07-20T23:59:59+09:00',
      submissionType: 'TEXT',
      submission: null,
    },
    {
      milestoneId: 'changes-locked',
      name: '재제출 불가 보완',
      dueAt: '2026-08-25T23:59:59+09:00',
      submissionType: 'TEXT',
      submission: submission('CHANGES_REQUESTED', { canResubmit: false }),
    },
  ],
};

describe('milestone timeline parser', () => {
  it('locked #116 checklist를 dueAt epoch ASC, KST D-day와 제출 상태로 변환한다', () => {
    // Given / When
    const timeline = parseMilestoneTimelineResponse(response, PROGRAM_ID, NOW);

    // Then
    expect(timeline.applicationMode).toBe('TEAM');
    expect(timeline.items.map((item) => item.milestoneId)).toEqual([
      'overdue',
      'text',
      'file',
      'release',
      'rejected',
      'missing',
      'changes-locked',
    ]);
    expect(timeline.items.map((item) => item.dDayLabel)).toEqual([
      'D+4',
      'D-Day',
      'D-6',
      'D-10',
      'D-17',
      'D-27',
      'D-32',
    ]);
    expect(timeline.items.map((item) => item.statusLabel)).toEqual([
      '미제출',
      '제출 완료',
      '보완 필요',
      '승인 완료',
      '반려',
      '미제출',
      '보완 필요',
    ]);
    expect(
      timeline.items.find((item) => item.milestoneId === 'file'),
    ).toMatchObject({
      submitHref: '/programs/program-1/submissions?milestoneId=file',
      submitLabel: '다시 제출',
    });
    expect(
      timeline.items.find((item) => item.milestoneId === 'missing'),
    ).toMatchObject({
      submitHref: '/programs/program-1/milestones/missing/submit',
      submitLabel: '제출하기',
    });
    expect(
      timeline.items.find((item) => item.milestoneId === 'overdue'),
    ).toMatchObject({
      submitHref: null,
      submitLabel: null,
    });
    expect(
      timeline.items.find((item) => item.milestoneId === 'changes-locked'),
    ).toMatchObject({
      submitHref: null,
      submitLabel: null,
    });
    expect(
      timeline.items.find((item) => item.milestoneId === 'file')
        ?.submissionGuide,
    ).toBe('PDF·HWP·이미지·압축 파일');
  });

  it('mixed offset dueAt을 문자열이 아니라 numeric epoch 기준으로 정렬한다', () => {
    // Given
    const mixedOffsetResponse = {
      applicationId: 'application-1',
      applicationMode: 'PERSONAL',
      items: [
        {
          milestoneId: 'ny-later',
          name: '뉴욕 기준 늦은 마감',
          dueAt: '2026-07-24T23:30:00-04:00',
          submissionType: 'TEXT',
          submission: null,
        },
        {
          milestoneId: 'seoul-earlier',
          name: '서울 기준 이른 마감',
          dueAt: '2026-07-25T08:00:00+09:00',
          submissionType: 'TEXT',
          submission: null,
        },
      ],
    };

    // When
    const timeline = parseMilestoneTimelineResponse(
      mixedOffsetResponse,
      PROGRAM_ID,
      NOW,
    );

    // Then
    expect(timeline.items.map((item) => item.milestoneId)).toEqual([
      'seoul-earlier',
      'ny-later',
    ]);
  });

  it.each([
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
