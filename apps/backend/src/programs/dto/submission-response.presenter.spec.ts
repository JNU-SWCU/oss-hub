import type {
  SubmissionChecklistResult,
  SubmissionFormResult,
} from '../submission-result.policy';
import {
  CreatedSubmissionResponseDto,
  ResubmittedSubmissionResponseDto,
  SubmissionChecklistResponseDto,
  SubmissionFormResponseDto,
} from './submission-form-response.dto';

const dueAt = new Date('2026-09-01T14:59:59.123Z');
const form: SubmissionFormResult = {
  applicationId: 'application',
  applicationMode: 'TEAM',
  milestone: {
    id: 'milestone',
    name: '중간 보고',
    dueAt,
    dDay: 1,
    deadlineLabel: 'D-1',
    submissionType: 'TEXT',
    instructions: null,
  },
  existingSubmission: { id: 'submission', status: 'CHANGES_REQUESTED' },
  canSubmit: false,
  blockedReason: 'SUBMISSION_ALREADY_EXISTS',
};

it('폼의 공개 필드, 업로드 한도와 기존 체크리스트 경로를 유지한다', () => {
  const result = { ...form, privateContext: 'not-on-wire' };
  expect(
    SubmissionFormResponseDto.from(result, 'program', 'milestone'),
  ).toEqual({
    applicationId: 'application',
    fileUpload: { maxBytes: 5 * 1024 * 1024, maxLabel: '5 MB' },
    applicationMode: 'TEAM',
    milestone: {
      id: 'milestone',
      name: '중간 보고',
      dueAt: '2026-09-01T14:59:59.123Z',
      dDay: 1,
      deadlineLabel: 'D-1',
      submissionType: 'TEXT',
      instructions: null,
    },
    existingSubmission: {
      id: 'submission',
      status: 'CHANGES_REQUESTED',
      checklistUrl: '/programs/program/submissions?milestoneId=milestone',
    },
    canSubmit: false,
    blockedReason: 'SUBMISSION_ALREADY_EXISTS',
  });
  expect(
    SubmissionFormResponseDto.from(
      {
        ...form,
        existingSubmission: null,
        canSubmit: true,
        blockedReason: null,
      },
      'program',
      'milestone',
    ).existingSubmission,
  ).toBeNull();
  expect(result.milestone.dueAt).toBe(dueAt);
});

it('생성 시각을 ISO로 반환하고 재제출 결과는 지정 필드만 반환한다', () => {
  expect(
    CreatedSubmissionResponseDto.from({
      submissionId: 'submission',
      status: 'SUBMITTED',
      submittedAt: dueAt,
    }),
  ).toEqual({
    submissionId: 'submission',
    status: 'SUBMITTED',
    submittedAt: '2026-09-01T14:59:59.123Z',
  });
  const result = {
    submissionId: 'submission',
    revision: 2,
    status: 'SUBMITTED' as const,
    privateContext: 'not-on-wire',
  };
  expect(ResubmittedSubmissionResponseDto.from(result)).toEqual({
    submissionId: 'submission',
    revision: 2,
    status: 'SUBMITTED',
  });
});

it('체크리스트 순서와 검토·파일 null 및 ISO 시각·다운로드 경로를 유지한다', () => {
  const result: SubmissionChecklistResult = {
    applicationId: 'application',
    applicationMode: 'PERSONAL',
    items: [
      {
        milestoneId: 'empty',
        name: '미제출',
        dueAt,
        submissionType: 'TEXT',
        submission: null,
      },
      {
        milestoneId: 'reviewed',
        name: '파일',
        dueAt,
        submissionType: 'FILE',
        submission: {
          id: 'submission',
          status: 'CHANGES_REQUESTED',
          currentRevision: 2,
          decision: 'CHANGES_REQUESTED',
          lastReviewedAt: dueAt,
          reviewComment: '보완',
          canResubmit: true,
          file: {
            fileId: 'file',
            fileName: '보고서.pdf',
            contentType: 'application/pdf',
            size: 42,
            expiresAt: dueAt,
          },
        },
      },
      {
        milestoneId: 'unreviewed',
        name: '텍스트',
        dueAt,
        submissionType: 'TEXT',
        submission: {
          id: 'unreviewed-submission',
          status: 'SUBMITTED',
          currentRevision: 1,
          decision: null,
          lastReviewedAt: null,
          reviewComment: null,
          canResubmit: false,
          file: null,
        },
      },
    ],
  };
  expect(SubmissionChecklistResponseDto.from(result)).toEqual({
    applicationId: 'application',
    fileUpload: { maxBytes: 5 * 1024 * 1024, maxLabel: '5 MB' },
    applicationMode: 'PERSONAL',
    items: [
      {
        milestoneId: 'empty',
        name: '미제출',
        dueAt: dueAt.toISOString(),
        submissionType: 'TEXT',
        submission: null,
      },
      {
        milestoneId: 'reviewed',
        name: '파일',
        dueAt: dueAt.toISOString(),
        submissionType: 'FILE',
        submission: {
          id: 'submission',
          status: 'CHANGES_REQUESTED',
          currentRevision: 2,
          decision: 'CHANGES_REQUESTED',
          lastReviewedAt: dueAt.toISOString(),
          reviewComment: '보완',
          canResubmit: true,
          file: {
            fileId: 'file',
            fileName: '보고서.pdf',
            contentType: 'application/pdf',
            size: 42,
            expiresAt: dueAt.toISOString(),
            downloadUrl: '/api/v1/submission-files/file',
          },
        },
      },
      {
        milestoneId: 'unreviewed',
        name: '텍스트',
        dueAt: dueAt.toISOString(),
        submissionType: 'TEXT',
        submission: {
          id: 'unreviewed-submission',
          status: 'SUBMITTED',
          currentRevision: 1,
          decision: null,
          lastReviewedAt: null,
          reviewComment: null,
          canResubmit: false,
          file: null,
        },
      },
    ],
  });
  expect(result.items[1]?.submission?.file?.expiresAt).toBe(dueAt);
});
