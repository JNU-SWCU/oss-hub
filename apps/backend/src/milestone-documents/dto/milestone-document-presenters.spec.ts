import type { MilestoneDocumentViewerResult } from '../domain/milestone-document-result';
import { presentMilestoneDocumentFeedback } from './milestone-document-feedback-response.dto';
import { presentMilestoneDocumentHistory } from './milestone-document-history-response.dto';
import { presentMilestoneDocumentViewer } from './milestone-document-response.dto';

const when = new Date('2026-10-20T01:02:03.123Z');

it('겸직자의 제출 상태와 운영 집계를 함께 보존하고 내부 양식 ID는 노출하지 않는다', () => {
  const result: MilestoneDocumentViewerResult = {
    id: 'document',
    milestoneId: 'milestone',
    name: '보고서',
    required: true,
    sortOrder: 2,
    graceDueAt: when,
    templateFileId: 'private-template-id',
    templateFileName: '양식.pdf',
    teamSubmissionCount: { submitted: 2, total: 3 },
    viewerSubmission: {
      submitted: true,
      submittedAt: when,
      submittedLate: true,
      revision: 2,
      status: 'CHANGES_REQUESTED',
      hasCurrentFile: false,
      currentFileName: null,
      review: { comment: '보완', reviewedAt: when, resubmissionDueAt: null },
      history: { hasHistory: true, isComplete: false },
    },
  };
  expect(presentMilestoneDocumentViewer(result)).toEqual({
    id: 'document',
    milestoneId: 'milestone',
    name: '보고서',
    required: true,
    sortOrder: 2,
    graceDueAt: '2026-10-20T01:02:03.123Z',
    hasTemplateFile: true,
    templateFileName: '양식.pdf',
    teamSubmissionCount: { submitted: 2, total: 3 },
    viewerSubmission: {
      submitted: true,
      submittedAt: '2026-10-20T01:02:03.123Z',
      submittedLate: true,
      revision: 2,
      status: 'CHANGES_REQUESTED',
      hasCurrentFile: false,
      currentFileName: null,
      review: {
        comment: '보완',
        reviewedAt: '2026-10-20T01:02:03.123Z',
        resubmissionDueAt: null,
      },
      history: { hasHistory: true, isComplete: false },
    },
  });
  expect(result.viewerSubmission?.submittedAt).toBe(when);
  const absent = presentMilestoneDocumentViewer({
    ...result,
    viewerSubmission: undefined,
    teamSubmissionCount: undefined,
  });
  expect(JSON.stringify(absent)).not.toMatch(
    /viewerSubmission|teamSubmissionCount|private-template-id/,
  );
});

it('학생 이력의 이미 가려진 검토자와 null 이력을 보존하고 다운로드 가능한 파일만 링크로 표현한다', () => {
  const item = {
    event: 'CHANGES_REQUESTED' as const,
    revision: null,
    actorNickname: '담당 교직원',
    comment: null,
    createdAt: when,
    fileName: '보고서.pdf',
    downloadableFileId: 'file',
    content: null,
  };
  expect(
    presentMilestoneDocumentHistory({
      items: [item, { ...item, downloadableFileId: null }],
      nextCursor: 'opaque-cursor',
      isComplete: false,
    }),
  ).toEqual({
    items: [
      {
        event: 'CHANGES_REQUESTED',
        revision: null,
        actorNickname: '담당 교직원',
        comment: null,
        createdAt: '2026-10-20T01:02:03.123Z',
        fileName: '보고서.pdf',
        downloadUrl: '/api/v1/submission-files/file',
        content: null,
      },
      {
        event: 'CHANGES_REQUESTED',
        revision: null,
        actorNickname: '담당 교직원',
        comment: null,
        createdAt: '2026-10-20T01:02:03.123Z',
        fileName: '보고서.pdf',
        downloadUrl: null,
        content: null,
      },
    ],
    nextCursor: 'opaque-cursor',
    isComplete: false,
  });
});

it('피드백의 마감 null과 기존 URL 인코딩을 보존한다', () => {
  const result = presentMilestoneDocumentFeedback({
    items: [
      {
        id: 'review',
        decision: 'APPROVED',
        comment: null,
        reviewedAt: when,
        resubmissionDueAt: null,
        applicationId: 'application',
        programId: 'program/1',
        milestoneId: 'seed:milestone?1',
        milestoneName: '중간',
        itemName: '보고서',
      },
    ],
  });
  expect(result.items[0]).toEqual({
    id: 'review',
    decision: 'APPROVED',
    comment: null,
    reviewedAt: '2026-10-20T01:02:03.123Z',
    resubmissionDueAt: null,
    applicationId: 'application',
    programId: 'program/1',
    milestoneId: 'seed:milestone?1',
    milestoneName: '중간',
    itemName: '보고서',
    href: '/programs/program%2F1/documents?milestoneId=seed%3Amilestone%3F1',
  });
});
