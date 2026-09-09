import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { ReviewSubmission } from './components/review-submission';
import { context } from './review-screen-test-support';

function renderSubmission(needsLatestRevision: boolean) {
  const review = context(2);
  return renderToStaticMarkup(
    <ReviewSubmission
      context={{
        ...review,
        currentRevision: {
          ...review.currentRevision,
          files: [
            {
              fileId: 'file-latest',
              fileName: 'latest-report.pdf',
              contentType: 'application/pdf',
              size: 1024,
              expiresAt: '2028-01-01T00:00:00.000Z',
              downloadUrl: apiPath('submission-files/file-latest'),
            },
          ],
        },
      }}
      needsLatestRevision={needsLatestRevision}
      isRefreshing={false}
      disabled={false}
      refreshError={null}
    />,
  );
}

describe('review submission display', () => {
  it('shows only the latest content and its current download URL', () => {
    const html = renderSubmission(false);
    expect(html).toContain('제출 글 2');
    expect(html).not.toContain('제출 글 1');
    expect(html).toContain(`href="${apiPath('submission-files/file-latest')}"`);
    expect(html).toContain('latest-report.pdf');
  });
  it('offers one transition before displaying the new content or file links', () => {
    const html = renderSubmission(true);
    expect(html).toContain('새 제출본이 도착했습니다.');
    expect(html).toContain('최신 제출본 2번 열기');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain('제출 글 2');
    expect(html).not.toContain('latest-report.pdf');
    expect(html).not.toContain('확인 완료');
  });
});
