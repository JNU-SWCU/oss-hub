import { submissionUploadLimit } from '../../../test-support/submission-upload-limit';
import { describe, expect, it, vi } from 'vitest';
import type { ProblemDetail } from '@/lib/api-client';
import {
  applyResubmission,
  checklistItemStatus,
  checklistSubmittedCount,
  hasMilestoneDeadlinePassed,
  milestoneDeadline,
  resubmissionContent,
  resubmissionFailure,
  sortChecklistItems,
  submitResubmissionRevision,
} from './submission-checklist';
import { SubmissionFileUploadCache } from './submission-form';
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
  const dueAt = '2026-09-01T14:59:59.000Z';

  it('Seoul 자정 직전에는 달력일 차이 그대로 D-2다', () => {
    const now = new Date('2026-08-30T14:59:59Z');

    expect(milestoneDeadline(dueAt, now)).toEqual({ dDay: 2, label: 'D-2' });
  });

  it('Seoul 자정을 넘기면 UTC 날짜가 그대로여도 하루가 줄어든다', () => {
    const now = new Date('2026-08-30T15:00:00Z');

    expect(milestoneDeadline(dueAt, now)).toEqual({ dDay: 1, label: 'D-1' });
  });

  it('마감 당일은 오늘 마감이다', () => {
    const now = new Date('2026-09-01T14:59:00Z');

    expect(milestoneDeadline(dueAt, now)).toEqual({
      dDay: 0,
      label: '오늘 마감',
    });
  });

  it('UTC 날짜는 같아도 Seoul 기준 다음 날이면 마감 지남이다', () => {
    const now = new Date('2026-09-01T15:00:00Z');

    const deadline = milestoneDeadline(dueAt, now);

    expect(deadline).toEqual({ dDay: -1, label: '마감 지남' });
  });

  it('+09:00 오프셋 표기도 같은 순간으로 계산한다', () => {
    const now = new Date('2026-08-30T15:00:00Z');

    expect(milestoneDeadline('2026-09-01T23:59:59+09:00', now)).toEqual({
      dDay: 1,
      label: 'D-1',
    });
  });
});

describe('hasMilestoneDeadlinePassed', () => {
  const dueAt = '2026-09-01T09:00:00.000Z';

  it('같은 날이라도 마감 시각을 넘겼으면 지난 것이다', () => {
    const now = new Date('2026-09-01T09:00:01Z');

    expect(milestoneDeadline(dueAt, now).dDay).toBe(0);
    expect(hasMilestoneDeadlinePassed(dueAt, now)).toBe(true);
  });

  it('같은 날 마감 시각 이전이면 아직 지나지 않았다', () => {
    const now = new Date('2026-09-01T08:59:59Z');

    expect(hasMilestoneDeadlinePassed(dueAt, now)).toBe(false);
  });

  it('마감 시각과 같은 순간은 아직 지나지 않았다', () => {
    const now = new Date(dueAt);

    expect(hasMilestoneDeadlinePassed(dueAt, now)).toBe(false);
  });

  it('읽을 수 없는 dueAt은 지나지 않은 것으로 본다', () => {
    const now = new Date('2026-09-01T09:00:01Z');

    expect(hasMilestoneDeadlinePassed('not-a-date', now)).toBe(false);
  });
});

describe('sortChecklistItems', () => {
  it('문자열 표기가 아니라 epoch 수치로 정렬한다', () => {
    const later = checklistItem({
      milestoneId: 'milestone-later',
      dueAt: '2026-09-01T00:30:00Z',
    });
    const earlier = checklistItem({
      milestoneId: 'milestone-earlier',
      dueAt: '2026-09-01T08:00:00+09:00',
    });

    const sorted = sortChecklistItems([later, earlier]);

    expect(sorted.map((item) => item.milestoneId)).toEqual([
      'milestone-earlier',
      'milestone-later',
    ]);
  });

  it('dueAt이 같으면 서버가 준 순서를 유지하고 원본을 바꾸지 않는다', () => {
    const first = checklistItem({
      milestoneId: 'milestone-1',
      dueAt: '2026-09-01T14:59:59.000Z',
    });
    const second = checklistItem({
      milestoneId: 'milestone-2',
      dueAt: '2026-09-01T14:59:59.000Z',
    });
    const items = [first, second];

    const sorted = sortChecklistItems(items);

    expect(sorted.map((item) => item.milestoneId)).toEqual([
      'milestone-1',
      'milestone-2',
    ]);
    expect(items[0]).toBe(first);
  });
});

describe('checklistSubmittedCount', () => {
  it('제출물이 있는 항목만 제출 수로 센다(리뷰 상태 무관)', () => {
    const items: SubmissionChecklistItem[] = [
      checklistItem({
        milestoneId: 'm1',
        dueAt: '2026-09-01T00:00:00Z',
        submission: {
          id: 's1',
          status: 'APPROVED',
          currentRevision: 1,
          decision: 'APPROVED',
          lastReviewedAt: null,
          reviewComment: null,
          canResubmit: false,
          file: null,
        },
      }),
      checklistItem({ milestoneId: 'm2', dueAt: '2026-09-02T00:00:00Z' }),
    ];

    expect(checklistSubmittedCount(items)).toEqual({
      total: 2,
      submitted: 1,
      revisionNeeded: 0,
    });
  });

  it('보완 요청 건수는 서버 상태가 보완 요청인 서류만 센다(재제출 가능 여부 무관)', () => {
    const items: SubmissionChecklistItem[] = [
      checklistItem({
        milestoneId: 'm-resubmit',
        dueAt: '2026-09-02T00:00:00Z',
        submission: {
          id: 's-resubmit',
          status: 'SUBMITTED',
          currentRevision: 1,
          decision: null,
          lastReviewedAt: null,
          reviewComment: null,
          canResubmit: true,
          file: null,
        },
      }),
      checklistItem({
        milestoneId: 'm-changes-requested',
        dueAt: '2026-09-03T00:00:00Z',
        submission: {
          id: 's-changes-requested',
          status: 'CHANGES_REQUESTED',
          currentRevision: 1,
          decision: 'CHANGES_REQUESTED',
          lastReviewedAt: null,
          reviewComment: null,
          canResubmit: false,
          file: null,
        },
      }),
    ];

    expect(checklistSubmittedCount(items)).toEqual({
      total: 2,
      submitted: 2,
      revisionNeeded: 1,
    });
  });

  it('빈 목록은 0/0이다', () => {
    expect(checklistSubmittedCount([])).toEqual({
      total: 0,
      submitted: 0,
      revisionNeeded: 0,
    });
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

  it.each([
    ['마감 전 검토 대기', 'SUBMITTED', null, true, 'SUBMITTED', 0],
    ['마감 뒤 검토 대기', 'SUBMITTED', null, false, 'SUBMITTED', 0],
    [
      '보완 요청을 받고 마감 전에 다시 낸 검토 대기',
      'SUBMITTED',
      'CHANGES_REQUESTED',
      true,
      'SUBMITTED',
      0,
    ],
    [
      '보완 요청',
      'CHANGES_REQUESTED',
      'CHANGES_REQUESTED',
      true,
      'CHANGES_REQUESTED',
      1,
    ],
  ] as const)(
    '%s(상태 %s, 지난 판정 %s, 재제출 가능 %s): 배지 %s, 보완 요청 %i건',
    (_label, status, decision, canResubmit, badge, revisionNeeded) => {
      const item = checklistItem({
        milestoneId: 'milestone-review',
        dueAt: '2026-09-01T14:59:59.000Z',
        submission: {
          id: 'submission-review',
          status,
          currentRevision: 1,
          decision,
          lastReviewedAt: null,
          reviewComment: null,
          canResubmit,
          file: null,
        },
      });

      expect(checklistItemStatus(item)).toBe(badge);
      expect(checklistSubmittedCount([item]).revisionNeeded).toBe(
        revisionNeeded,
      );
    },
  );
});

describe('resubmissionFailure', () => {
  it.each(['SUB_013', 'SUB_014'])(
    '409 %s는 코드와 무관하게 최신 상태 다시 불러오기다',
    (code) => {
      const conflict = problem({ status: 409, code });

      expect(resubmissionFailure(conflict, 'TEXT')).toEqual({ kind: 'stale' });
    },
  );

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

  it('SUB_011 maps FILE resubmission failures to the file field', () => {
    const failure = resubmissionFailure(
      problem({ status: 422, code: 'SUB_011', detail: 'file is required' }),
      'FILE',
    );
    expect(failure).toEqual({
      kind: 'field',
      field: 'file',
      message: 'file is required',
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
      resubmissionContent('TEXT', {
        file: null,
        text: '  보완 내용  ',
      }),
    ).toEqual({ type: 'TEXT', text: '보완 내용' });
  });

  it('FILE uses the uploaded file id for resubmission content', () => {
    expect(
      resubmissionContent('FILE', { file: null, text: '' }, 'file-1'),
    ).toEqual({ type: 'FILE', fileId: 'file-1' });
  });
});

describe('submitResubmissionRevision', () => {
  const file = new File(['%PDF'], 'replacement.pdf', {
    type: 'application/pdf',
  });

  it('uploads FILE content first with resubmission context, then creates the next revision', async () => {
    const cache = new SubmissionFileUploadCache();
    const uploadSubmissionFile = vi
      .fn()
      .mockResolvedValue({ fileId: 'file-replacement' });
    const createResubmission = vi.fn().mockResolvedValue({
      submissionId: 'submission-1',
      revision: 4,
      status: 'SUBMITTED',
    });
    const phases: string[] = [];

    const result = await submitResubmissionRevision({
      applicationId: 'application-1',
      milestoneId: 'milestone-file',
      submission: { id: 'submission-1', currentRevision: 3 },
      submissionType: 'FILE',
      input: { file, text: '' },
      comment: 'updated file',
      cache,
      uploadSubmissionFile,
      createResubmission,
      onPhaseChange: (phase) => phases.push(phase),
    });

    expect(result).toEqual({
      submissionId: 'submission-1',
      revision: 4,
      status: 'SUBMITTED',
    });
    expect(uploadSubmissionFile).toHaveBeenCalledWith(
      'application-1',
      'milestone-file',
      file,
      { submissionId: 'submission-1', baseRevision: 3 },
    );
    expect(createResubmission).toHaveBeenCalledWith({
      submissionId: 'submission-1',
      baseRevision: 3,
      content: { type: 'FILE', fileId: 'file-replacement' },
      comment: 'updated file',
    });
    expect(phases).toEqual(['uploading', 'creating']);
  });

  it('reuses the cached upload when revision creation fails and the same file is retried', async () => {
    const cache = new SubmissionFileUploadCache();
    const uploadSubmissionFile = vi
      .fn()
      .mockResolvedValue({ fileId: 'file-replacement' });
    const createResubmission = vi
      .fn()
      .mockRejectedValueOnce(new Error('revision failed'))
      .mockResolvedValueOnce({
        submissionId: 'submission-1',
        revision: 4,
        status: 'SUBMITTED',
      });
    const input = {
      applicationId: 'application-1',
      milestoneId: 'milestone-file',
      submission: { id: 'submission-1', currentRevision: 3 },
      submissionType: 'FILE' as const,
      input: { file, text: '' },
      comment: 'updated file',
      cache,
      uploadSubmissionFile,
      createResubmission,
    };

    await expect(submitResubmissionRevision(input)).rejects.toThrow(
      'revision failed',
    );
    await expect(submitResubmissionRevision(input)).resolves.toEqual({
      submissionId: 'submission-1',
      revision: 4,
      status: 'SUBMITTED',
    });
    expect(uploadSubmissionFile).toHaveBeenCalledTimes(1);
    expect(createResubmission).toHaveBeenCalledTimes(2);
  });
});

describe('applyResubmission', () => {
  const DUE_AT = '2026-09-01T14:59:59.000Z';

  function resubmittedChecklist(now: Date) {
    const target = checklistItem({
      milestoneId: 'milestone-target',
      dueAt: DUE_AT,
      submission: {
        id: 'submission-1',
        status: 'CHANGES_REQUESTED',
        currentRevision: 1,
        decision: 'CHANGES_REQUESTED',
        lastReviewedAt: '2026-08-28T01:00:00.000Z',
        reviewComment: '실행 화면을 추가해 주세요',
        canResubmit: true,
        file: null,
      },
    });
    const other = checklistItem({
      milestoneId: 'milestone-other',
      dueAt: '2026-09-10T14:59:59.000Z',
    });
    const checklist: SubmissionChecklist = {
      applicationId: 'application-personal',
      applicationMode: 'PERSONAL',
      fileUpload: submissionUploadLimit(),
      items: [target, other],
    };
    const next = applyResubmission(
      checklist,
      'milestone-target',
      { submissionId: 'submission-1', revision: 2, status: 'SUBMITTED' },
      now,
    );
    return { next, target, other };
  }

  it('마감 전 재제출은 지난 판정을 지우지 않고 다음 조회와 같은 행을 만든다', () => {
    const { next, target, other } = resubmittedChecklist(
      new Date('2026-08-31T14:59:59.000Z'),
    );

    expect(next.items[0]?.submission).toEqual({
      id: 'submission-1',
      status: 'SUBMITTED',
      currentRevision: 2,
      decision: 'CHANGES_REQUESTED',
      lastReviewedAt: '2026-08-28T01:00:00.000Z',
      reviewComment: '실행 화면을 추가해 주세요',

      canResubmit: true,
      file: null,
    });
    expect(next.items[1]).toBe(other);

    expect(target.submission?.status).toBe('CHANGES_REQUESTED');
  });

  it('마감 뒤 재제출은 더 낼 수 없다고 표시한다', () => {
    const { next } = resubmittedChecklist(new Date('2026-09-01T15:00:00.000Z'));

    expect(next.items[0]?.submission?.canResubmit).toBe(false);
    expect(next.items[0]?.submission?.decision).toBe('CHANGES_REQUESTED');
  });
});
