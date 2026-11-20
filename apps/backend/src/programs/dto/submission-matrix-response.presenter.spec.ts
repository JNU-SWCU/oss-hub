import { SubmissionMatrixResponseDto } from './submission-matrix-response.dto';
import { type SubmissionMatrixResult } from '../submission-matrix.service';

it('행·셀 순서, 상태 건수, 팀장 이름, 페이지와 nullable 제출 정보를 보존한다', () => {
  const dueAt = new Date('2026-10-01T14:59:59.123Z');
  const statusCounts = {
    NOT_SUBMITTED: 2,
    SUBMITTED: 3,
    CHANGES_REQUESTED: 4,
    REJECTED: 1,
    APPROVED: 13,
  };
  const result: SubmissionMatrixResult = {
    milestones: [
      { id: 'second', name: '후반', dueAt },
      { id: 'first', name: '전반', dueAt },
    ],
    rows: [
      {
        teamId: 'application',
        applicationMode: 'TEAM',
        displayName: '합성 팀',
        leaderName: '합성 팀장',
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
    statusCounts,
  };
  expect(SubmissionMatrixResponseDto.from(result)).toEqual({
    milestones: [
      { id: 'second', name: '후반', dueAt: dueAt.toISOString() },
      { id: 'first', name: '전반', dueAt: dueAt.toISOString() },
    ],
    rows: [
      {
        teamId: 'application',
        applicationMode: 'TEAM',
        displayName: '합성 팀',
        leaderName: '합성 팀장',
        githubLogins: ['leader', 'member'],
        cells: [
          {
            milestoneId: 'second',
            submissionId: 'submission',
            revision: 3,
            status: 'CHANGES_REQUESTED',
            submittedAt: dueAt.toISOString(),
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
    statusCounts,
  });
  expect(result.rows[0]?.cells[0]?.submittedAt).toBe(dueAt);
});
