import { describe, expect, it } from 'vitest';
import type { ProblemDetail } from '@/lib/api-client';
import {
  applyResubmission,
  CHECKLIST_STATUS_LABELS,
  checklistItemStatus,
  deadlineVariant,
  milestoneDeadline,
  resubmissionContent,
  resubmissionFailure,
  sortChecklistItems,
} from './submission-checklist';
import type { SubmissionChecklist, SubmissionChecklistItem } from './types';

function checklistItem(
  overrides: Partial<SubmissionChecklistItem> &
    Pick<SubmissionChecklistItem, 'milestoneId' | 'dueAt'>,
): SubmissionChecklistItem {
  return {
    name: '합성 마일스톤',
    submissionType: 'TEXT',
    submission: null,
    ...overrides,
  };
}

function problem(overrides: Partial<ProblemDetail>): ProblemDetail {
  return {
    type: 'about:blank',
    title: '합성 오류',
    status: 400,
    detail: '합성 오류 상세',
    instance: '/synthetic/submissions/submission-1/resubmissions',
    code: 'SUB_000',
    ...overrides,
  };
}

describe('milestoneDeadline', () => {
  // dueAt 2026-09-01T23:59:59+09:00 == 2026-09-01T14:59:59Z.
  const dueAt = '2026-09-01T14:59:59.000Z';

  it('Seoul 자정 직전에는 달력일 차이 그대로 D-2다', () => {
    // Given: Seoul 2026-08-30 23:59:59.
    const now = new Date('2026-08-30T14:59:59Z');

    // When / Then
    expect(milestoneDeadline(dueAt, now)).toEqual({ dDay: 2, label: 'D-2' });
  });

  it('Seoul 자정을 넘기면 UTC 날짜가 그대로여도 하루가 줄어든다', () => {
    // Given: UTC로는 여전히 08-30이지만 Seoul은 08-31 00:00:00.
    const now = new Date('2026-08-30T15:00:00Z');

    // When / Then
    expect(milestoneDeadline(dueAt, now)).toEqual({ dDay: 1, label: 'D-1' });
  });

  it('마감 당일은 오늘 마감이다', () => {
    // Given: Seoul 2026-09-01 23:59:00.
    const now = new Date('2026-09-01T14:59:00Z');

    // When / Then
    expect(milestoneDeadline(dueAt, now)).toEqual({
      dDay: 0,
      label: '오늘 마감',
    });
  });

  it('UTC 날짜는 같아도 Seoul 기준 다음 날이면 마감 지남이다', () => {
    // Given: UTC 2026-09-01 15:00 == Seoul 2026-09-02 00:00.
    const now = new Date('2026-09-01T15:00:00Z');

    // When
    const deadline = milestoneDeadline(dueAt, now);

    // Then: UTC 달력으로 계산하면 dDay 0이 나오는 경계 케이스.
    expect(deadline).toEqual({ dDay: -1, label: '마감 지남' });
  });

  it('+09:00 오프셋 표기도 같은 순간으로 계산한다', () => {
    // Given
    const now = new Date('2026-08-30T15:00:00Z');

    // When / Then
    expect(milestoneDeadline('2026-09-01T23:59:59+09:00', now)).toEqual({
      dDay: 1,
      label: 'D-1',
    });
  });
});

describe('deadlineVariant', () => {
  it.each([
    [-1, 'rejected'],
    [0, 'pending'],
    [3, 'recruiting'],
  ] as const)('dDay %i은 %s variant다', (dDay, variant) => {
    expect(deadlineVariant(dDay)).toBe(variant);
  });
});

describe('sortChecklistItems', () => {
  it('문자열 표기가 아니라 epoch 수치로 정렬한다', () => {
    // Given: 문자열 비교로는 Z 표기가 앞서지만 실제 순간은 +09:00 쪽이 빠르다.
    const later = checklistItem({
      milestoneId: 'milestone-later',
      dueAt: '2026-09-01T00:30:00Z',
    });
    const earlier = checklistItem({
      milestoneId: 'milestone-earlier',
      dueAt: '2026-09-01T08:00:00+09:00', // == 2026-08-31T23:00:00Z
    });

    // When
    const sorted = sortChecklistItems([later, earlier]);

    // Then
    expect(sorted.map((item) => item.milestoneId)).toEqual([
      'milestone-earlier',
      'milestone-later',
    ]);
  });

  it('dueAt이 같으면 서버가 준 순서를 유지하고 원본을 바꾸지 않는다', () => {
    // Given
    const first = checklistItem({
      milestoneId: 'milestone-1',
      dueAt: '2026-09-01T14:59:59.000Z',
    });
    const second = checklistItem({
      milestoneId: 'milestone-2',
      dueAt: '2026-09-01T14:59:59.000Z',
    });
    const items = [first, second];

    // When
    const sorted = sortChecklistItems(items);

    // Then
    expect(sorted.map((item) => item.milestoneId)).toEqual([
      'milestone-1',
      'milestone-2',
    ]);
    expect(items[0]).toBe(first);
  });
});

describe('checklistItemStatus', () => {
  it('submission=null은 NOT_SUBMITTED로 본다', () => {
    expect(
      checklistItemStatus(
        checklistItem({
          milestoneId: 'milestone-1',
          dueAt: '2026-09-01T14:59:59.000Z',
        }),
      ),
    ).toBe('NOT_SUBMITTED');
  });

  it('상태 라벨 5종은 programs 화면과 같은 한국어 문구다', () => {
    expect(CHECKLIST_STATUS_LABELS).toEqual({
      NOT_SUBMITTED: '제출 전',
      SUBMITTED: '제출됨',
      APPROVED: '승인',
      CHANGES_REQUESTED: '보완 필요',
      REJECTED: '최종 반려',
    });
  });
});

describe('resubmissionFailure', () => {
  it.each(['SUB_013', 'SUB_014'])(
    '409 %s는 코드와 무관하게 최신 상태 다시 불러오기다',
    (code) => {
      // Given: RESUBMISSION_NOT_ALLOWED(SUB_013)·STALE_SUBMISSION_REVISION(SUB_014).
      const conflict = problem({ status: 409, code });

      // When / Then
      expect(resubmissionFailure(conflict, 'TEXT')).toEqual({ kind: 'stale' });
    },
  );

  it('SUB_009는 releaseUrl field 오류다', () => {
    const failure = resubmissionFailure(
      problem({ status: 422, code: 'SUB_009', detail: '저장소 밖 URL' }),
      'REPOSITORY_RELEASE',
    );
    expect(failure).toEqual({
      kind: 'field',
      field: 'releaseUrl',
      message: '저장소 밖 URL',
    });
  });

  it('SUB_011은 제출 유형에 맞는 field로 돌아간다', () => {
    const failure = resubmissionFailure(
      problem({ status: 422, code: 'SUB_011', detail: '내용 필요' }),
      'TEXT',
    );
    expect(failure).toEqual({
      kind: 'field',
      field: 'text',
      message: '내용 필요',
    });
  });

  it('그 밖의 오류는 Alert로 보여준다', () => {
    const failure = resubmissionFailure(
      problem({ status: 500, code: 'API_000', detail: '서버 오류' }),
      'TEXT',
    );
    expect(failure).toEqual({ kind: 'alert', message: '서버 오류' });
  });
});

describe('resubmissionContent', () => {
  it('TEXT는 앞뒤 공백을 정리해 보낸다', () => {
    expect(
      resubmissionContent('TEXT', { text: '  보완 내용  ', releaseUrl: '' }),
    ).toEqual({ type: 'TEXT', text: '보완 내용' });
  });

  it('REPOSITORY_RELEASE는 releaseUrl을 보낸다', () => {
    expect(
      resubmissionContent('REPOSITORY_RELEASE', {
        text: '',
        releaseUrl: 'https://github.com/JNU-SWCU/synthetic/releases/tag/v2 ',
      }),
    ).toEqual({
      type: 'REPOSITORY_RELEASE',
      releaseUrl: 'https://github.com/JNU-SWCU/synthetic/releases/tag/v2',
    });
  });

  it('FILE은 업로드 미지원이라 null이다', () => {
    expect(resubmissionContent('FILE', { text: '', releaseUrl: '' })).toBe(
      null,
    );
  });
});

describe('applyResubmission', () => {
  it('대상 행만 SUBMITTED·새 revision으로 갱신하고 나머지는 보존한다', () => {
    // Given
    const target = checklistItem({
      milestoneId: 'milestone-target',
      dueAt: '2026-09-01T14:59:59.000Z',
      submission: {
        id: 'submission-1',
        status: 'CHANGES_REQUESTED',
        currentRevision: 1,
        lastReviewedAt: '2026-08-28T01:00:00.000Z',
        reviewComment: '실행 화면을 추가해 주세요',
        canResubmit: true,
      },
    });
    const other = checklistItem({
      milestoneId: 'milestone-other',
      dueAt: '2026-09-10T14:59:59.000Z',
    });
    const checklist: SubmissionChecklist = {
      applicationId: 'application-personal',
      applicationMode: 'PERSONAL',
      items: [target, other],
    };

    // When
    const next = applyResubmission(checklist, 'milestone-target', {
      submissionId: 'submission-1',
      revision: 2,
      status: 'SUBMITTED',
    });

    // Then
    expect(next.items[0]?.submission).toEqual({
      id: 'submission-1',
      status: 'SUBMITTED',
      currentRevision: 2,
      lastReviewedAt: '2026-08-28T01:00:00.000Z',
      reviewComment: '실행 화면을 추가해 주세요',
      canResubmit: false,
    });
    expect(next.items[1]).toBe(other);
    // 원본은 그대로 — 이전 상태를 덮어쓰지 않는다.
    expect(target.submission?.status).toBe('CHANGES_REQUESTED');
  });
});
