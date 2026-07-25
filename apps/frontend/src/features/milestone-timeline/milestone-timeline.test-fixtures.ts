import type { SubmittedStatus } from './types';

export const NOW = new Date('2026-07-24T09:00:00+09:00');
export const PROGRAM_ID = 'program-1';

function submission(
  status: SubmittedStatus,
  options: {
    readonly canResubmit?: boolean;
  } = {},
) {
  return {
    id: `submission-${status}`,
    status,
    currentRevision: 2,
    lastReviewedAt:
      status === 'SUBMITTED' ? null : '2026-07-23T12:00:00+09:00',
    reviewComment:
      status === 'CHANGES_REQUESTED' ? '보완해 주세요.' : null,
    canResubmit: options.canResubmit ?? status === 'CHANGES_REQUESTED',
  };
}

export const response = {
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
      submission: submission('SUBMITTED'),
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
