import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { createReview, getReviewContext, publishRepository } from './api';
import { publishRepository as publishRepositoryDirect } from '@/lib/repository-publication';
import type { ReviewContext } from './types';

const context: ReviewContext = {
  requirementId: 'requirement-text',
  submissionId: 'submission-existing',
  application: {
    id: 'application-personal',
    applicationMode: 'PERSONAL',
    displayName: '합성 신청자',
  },
  milestone: { id: 'milestone-final', name: '최종 제출' },
  currentRevision: {
    number: 2,
    content: { type: 'TEXT', text: '활동 내용' },
    comment: null,
    submittedAt: '2026-09-27T01:00:00Z',
    files: [],
    review: {
      id: 'previous-review',
      decision: 'APPROVED',
      comment: null,
      reviewedAt: '2026-09-28T00:00:00Z',
    },
  },
  history: [],
  repository: null,
};
const document = {
  id: context.requirementId,
  milestoneId: context.milestone.id,
  name: '활동 내용',
  required: true,
  submissionType: 'TEXT',
  sortOrder: 0,
  hasTemplateFile: false,
  templateFileName: null,
};
const fileUpload = {
  maxBytes: 5242880,
  maxLabel: '5 MB',
  accept: '.pdf,.hwp,.zip',
  formatLabel: 'PDF, HWP, ZIP',
};
function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
afterEach(() => vi.unstubAllGlobals());

describe('reviews api', () => {
  it.each(['submission-existing', 'submission/one'])(
    'resolves an existing review link %s to its typed requirement',
    async (submissionId) => {
      const wireContext = {
        submissionId: context.submissionId,
        application: context.application,
        milestone: context.milestone,
        currentRevision: context.currentRevision,
        history: context.history,
        repository: context.repository,
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json(wireContext))
        .mockResolvedValueOnce(
          json({
            documents: [
              {
                ...document,
                id: 'other-document',
                submissionType: 'FILE_OR_TEXT',
              },
              document,
            ],
            fileUpload,
          }),
        );
      vi.stubGlobal('fetch', fetchMock);
      await expect(getReviewContext(submissionId)).resolves.toEqual(context);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        apiPath(
          'submissions/' + encodeURIComponent(submissionId) + '/review-context',
        ),
        undefined,
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        apiPath('milestones/milestone-final/documents?scope=all'),
        undefined,
      );
    },
  );
  it.each([
    { documents: [] },
    { documents: [document, { ...document, id: 'ambiguous' }] },
  ])(
    'does not guess a missing or ambiguous requirement',
    async ({ documents }) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json(context))
        .mockResolvedValueOnce(json({ documents, fileUpload }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(getReviewContext(context.submissionId)).rejects.toThrow(
        TypeError,
      );
    },
  );
  it('sends a reasonless rejection with the observed revision and latest review to the requirement endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        id: 'review-new',
        decision: 'REJECTED',
        comment: null,
        reviewedAt: '2026-09-29T00:00:00Z',
        resubmissionDueAt: null,
        reviewerNickname: 'synthetic-staff',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      createReview(context, { revision: 2, decision: 'REJECTED' }),
    ).resolves.toEqual({
      reviewId: 'review-new',
      submissionStatus: 'REJECTED',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath(
        'milestones/milestone-final/documents/requirement-text/applications/application-personal/reviews',
      ),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'REJECTED',
          expectedRevision: 2,
          expectedLatestReviewId: 'previous-review',
        }),
      },
    );
  });
  it('repository id로 별도 공개 전환을 요청한다', async () => {
    const response = {
      repositoryId: 'repository-ready',
      visibility: 'PUBLIC',
      publishedAt: '2026-10-01T01:00:00.000Z',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishRepository('repository-ready');

    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('repositories/repository-ready/publish'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isConfirmed: true }),
      },
    );
  });

  it('repository publication은 slash가 포함된 id를 인코딩한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          repositoryId: 'repo/one',
          visibility: 'PUBLIC',
          publishedAt: '2026-10-01T01:00:00.000Z',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await publishRepositoryDirect('repo/one');

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('repositories/repo%2Fone/publish'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
