import { describe, expect, it } from 'vitest';

import { parseMilestoneTimelineResponse } from './loader';
import { NOW, PROGRAM_ID, response } from './milestone-timeline.test-fixtures';

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
      '제출 전',
      '제출됨',
      '보완 필요',
      '승인',
      '최종 반려',
      '제출 전',
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
