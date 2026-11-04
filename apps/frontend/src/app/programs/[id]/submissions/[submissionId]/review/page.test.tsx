import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { programHref } from '@/features/programs/program-paths';
import { getReviewContext } from '@/features/reviews/api';
import type { ReviewContext } from '@/features/reviews/types';
import { apiPath } from '@/lib/api-client';

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn<(submissionId: string) => void>(),
}));

vi.mock('../../../../../_shell/role-gate', () => ({
  RoleGate: ({
    allow,
    children,
  }: {
    readonly allow: readonly string[];
    readonly children: ReactNode;
  }) => <section data-allow={allow.join(',')}>{children}</section>,
}));

vi.mock('@/features/reviews', () => ({
  SubmissionReviewScreen: ({
    programId,
    submissionId,
  }: {
    readonly programId: string;
    readonly submissionId: string;
  }) => {
    mocks.loadContext(submissionId);
    return (
      <div data-program-id={programId} data-submission-id={submissionId}>
        <a href={programHref(programId)}>submission review</a>
      </div>
    );
  },
}));

import ProgramSubmissionReviewPage from './page';

afterEach(() => {
  mocks.loadContext.mockReset();
  vi.unstubAllGlobals();
});

describe('ProgramSubmissionReviewPage access contract', () => {
  it.each([
    {
      programId: 'seed:milestones:program',
      submissionId: 'seed:milestones:submission-existing:submission',
      expectedProgramPath: '/programs/seed%3Amilestones%3Aprogram',
      expectedReviewPath:
        'submissions/seed%3Amilestones%3Asubmission-existing%3Asubmission/review-context',
    },
    {
      programId: 'program-existing',
      submissionId: 'submission-existing',
      expectedProgramPath: '/programs/program-existing',
      expectedReviewPath: 'submissions/submission-existing/review-context',
    },
  ])(
    '$submissionId의 라우트에서 API와 링크 경로를 한 번만 인코딩한다',
    async ({
      programId,
      submissionId,
      expectedProgramPath,
      expectedReviewPath,
    }) => {
      const context: Omit<ReviewContext, 'requirementId'> = {
        submissionId,
        application: {
          id: 'application-existing',
          applicationMode: 'PERSONAL',
          displayName: '신청자',
        },
        milestone: { id: 'milestone-existing', name: '최종 제출' },
        currentRevision: {
          number: 1,
          content: { type: 'TEXT', text: '제출 내용' },
          comment: null,
          submittedAt: '2026-11-04T00:00:00.000Z',
          files: [],
          review: null,
        },
        history: [],
        repository: null,
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(context), {
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              documents: [
                { id: 'requirement-existing', submissionType: 'TEXT' },
              ],
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        );
      vi.stubGlobal('fetch', fetchMock);
      const requests: Promise<unknown>[] = [];
      mocks.loadContext.mockImplementation((id) => {
        requests.push(getReviewContext(id));
      });
      const params = Promise.resolve({
        id: encodeURIComponent(programId),
        submissionId: encodeURIComponent(submissionId),
      });

      const page = await ProgramSubmissionReviewPage({ params });
      const html = renderToStaticMarkup(page);
      await Promise.all(requests);

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        apiPath(expectedReviewPath),
        undefined,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(html).toContain(`href="${expectedProgramPath}"`);
    },
  );

  it('승인된 STAFF만 요청한 submission 검토 화면에 허용한다', async () => {
    const params = Promise.resolve({
      id: 'program-existing',
      submissionId: 'submission-existing',
    });

    const page = await ProgramSubmissionReviewPage({ params });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-allow="staff"');
    expect(html).toContain('data-submission-id="submission-existing"');
    expect(html).toContain('data-program-id="program-existing"');
    expect(html).not.toContain('STUDENT');
  });
});
