import { SubmissionMatrixResponseDto } from './submission-matrix-response.dto';
import { type SubmissionMatrixResult } from '../submission-matrix.service';

it('행·셀 순서, 집계, 페이지와 nullable 제출 시각·검토 경로를 보존한다', () => {
  const dueAt = new Date('2026-10-01T14:59:59.123Z');
  const result: SubmissionMatrixResult = {
    milestones: [
      { id: 'second', name: '후반', dueAt },
      { id: 'first', name: '전반', dueAt },
    ],
    rows: [
      {
        applicationId: 'application',
        applicationMode: 'TEAM',
        displayName: '합성 팀',
        githubLogins: ['leader', 'member'],
        cells: [
          {
            milestoneId: 'second',
            submissionId: 'submission',
            revision: 3,
            status: 'CHANGES_REQUESTED',
            submittedAt: dueAt,
            deliveryStatus: 'LATE',
            changesRequestedCount: 2,
          },
          {
            milestoneId: 'first',
            submissionId: 'undated',
            revision: 1,
            status: 'SUBMITTED',
            submittedAt: null,
            deliveryStatus: 'MISSING',
            changesRequestedCount: 0,
          },
          {
            milestoneId: 'empty',
            submissionId: null,
            revision: null,
            status: 'NOT_SUBMITTED',
            submittedAt: null,
            deliveryStatus: 'NO_REQUIRED_ITEMS',
            changesRequestedCount: 0,
          },
        ],
      },
    ],
    page: 2,
    pageSize: 10,
    total: 11,
  };
  expect(SubmissionMatrixResponseDto.from(result, 'program')).toEqual({
    milestones: [
      { id: 'second', name: '후반', dueAt: dueAt.toISOString() },
      { id: 'first', name: '전반', dueAt: dueAt.toISOString() },
    ],
    rows: [
      {
        applicationId: 'application',
        applicationMode: 'TEAM',
        displayName: '합성 팀',
        githubLogins: ['leader', 'member'],
        cells: [
          {
            milestoneId: 'second',
            submissionId: 'submission',
            revision: 3,
            status: 'CHANGES_REQUESTED',
            submittedAt: dueAt.toISOString(),
            reviewUrl: '/programs/program/submissions/submission/review',
            deliveryStatus: 'LATE',
            changesRequestedCount: 2,
          },
          {
            milestoneId: 'first',
            submissionId: 'undated',
            revision: 1,
            status: 'SUBMITTED',
            submittedAt: null,
            reviewUrl: '/programs/program/submissions/undated/review',
            deliveryStatus: 'MISSING',
            changesRequestedCount: 0,
          },
          {
            milestoneId: 'empty',
            submissionId: null,
            revision: null,
            status: 'NOT_SUBMITTED',
            submittedAt: null,
            reviewUrl: null,
            deliveryStatus: 'NO_REQUIRED_ITEMS',
            changesRequestedCount: 0,
          },
        ],
      },
    ],
    page: 2,
    pageSize: 10,
    total: 11,
  });
  expect(result.rows[0]?.cells[0]?.submittedAt).toBe(dueAt);
});
