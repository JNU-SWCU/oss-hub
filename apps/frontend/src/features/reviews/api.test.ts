import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { createReview, getReviewContext, publishRepository } from './api';
import { publishRepository as publishRepositoryDirect } from '@/lib/repository-publication';
import type { ReviewContext } from './types';

const context: ReviewContext = {
  latestReviewId: 'previous-review',
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
function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
afterEach(() => vi.unstubAllGlobals());

describe('reviews api', () => {
  it('uses the latest review token without assigning an unknown review to the current revision', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      json({
        id: 'new-review',
        decision: 'APPROVED',
        comment: null,
        reviewedAt: '2026-11-05T01:00:00Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await createReview(
      {
        ...context,
        latestReviewId: 'historical-review',
        currentRevision: { ...context.currentRevision, review: null },
        unversionedReviews: [
          {
            id: 'historical-review',
            decision: 'APPROVED',
            comment: 'preserved',
            reviewedAt: '2026-01-15T12:00:00Z',
          },
        ],
      },
      {
        decision: 'APPROVED',
        comment: '',
        revision: context.currentRevision.number,
      },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining<Record<string, unknown>>({
        body: expect.stringContaining(
          '"expectedLatestReviewId":"historical-review"',
        ),
      }),
    );
  });
  it.each(['submission-existing', 'submission/one'])(
    'uses the canonical requirement coordinate returned for public submission %s',
    async (submissionId) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(json(context));
      vi.stubGlobal('fetch', fetchMock);
      await expect(getReviewContext(submissionId)).resolves.toEqual(context);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        apiPath(
          'submissions/' + encodeURIComponent(submissionId) + '/review-context',
        ),
        undefined,
      );
    },
  );
  it.each([true, false])(
    'loads and reviews a legacy null-content FILE submission with downloadable file=%s',
    async (hasDownloadableFile) => {
      const files = hasDownloadableFile
        ? [
            {
              fileId: 'legacy-file',
              fileName: 'report.pdf',
              contentType: 'application/pdf',
              size: 128,
              expiresAt: '2099-01-01T00:00:00Z',
              downloadUrl: 'https://files.example.test/report.pdf',
            },
          ]
        : [];
      const wireContext = {
        latestReviewId: 'previous-review',
        requirementId: 'legacy-file-item',
        submissionId: context.submissionId,
        application: context.application,
        milestone: context.milestone,
        currentRevision: { ...context.currentRevision, content: null, files },
        history: [],
        repository: null,
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json(wireContext))

        .mockResolvedValueOnce(
          json({
            id: 'review-new',
            decision: 'REJECTED',
            comment: null,
            reviewedAt: '2026-09-29T00:00:00Z',
            reviewerNickname: 'synthetic-staff',
          }),
        );
      vi.stubGlobal('fetch', fetchMock);

      const loaded = await getReviewContext(context.submissionId);
      expect(loaded.requirementId).toBe('legacy-file-item');
      expect(loaded.currentRevision.content).toBeNull();
      await createReview(loaded, { revision: 2, decision: 'REJECTED' });

      expect(fetchMock).toHaveBeenLastCalledWith(
        apiPath(
          'milestones/milestone-final/documents/legacy-file-item/teams/application-personal/reviews',
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
    },
  );
  it('sends a reasonless rejection with the observed revision and latest review to the requirement endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        id: 'review-new',
        decision: 'REJECTED',
        comment: null,
        reviewedAt: '2026-09-29T00:00:00Z',
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
        'milestones/milestone-final/documents/requirement-text/teams/application-personal/reviews',
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
