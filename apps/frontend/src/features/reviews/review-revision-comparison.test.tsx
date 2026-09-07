import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { ReviewRevisionComparison } from './components/review-revision-comparison';
import type {
  ReviewContext,
  SubmissionRevision,
  SubmissionRevisionFile,
} from './types';

const oldFile: SubmissionRevisionFile = {
  fileId: 'file-original',
  fileName: 'original-report.pdf',
  contentType: 'application/pdf',
  size: 1024,
  expiresAt: '2028-01-01T00:00:00.000Z',
  downloadUrl: apiPath('submission-files/file-original'),
};
const original: SubmissionRevision = {
  number: 1,
  content: { type: 'TEXT', text: '처음 검토한 글' },
  comment: '처음 제출 의견',
  submittedAt: '2026-09-01T01:00:00.000Z',
  files: [oldFile],
  review: null,
};
function renderComparison(history: readonly SubmissionRevision[]) {
  const context: ReviewContext = {
    submissionId: 'submission-synthetic',
    application: {
      id: 'application-synthetic',
      applicationMode: 'PERSONAL',
      displayName: '합성 신청자',
    },
    milestone: { id: 'milestone-final', name: '최종 제출' },
    repository: null,
    currentRevision: {
      ...original,
      number: 2,
      content: { type: 'TEXT', text: '최신 제출 글' },
      submittedAt: '2026-09-02T02:00:00.000Z',
      files: [
        {
          ...oldFile,
          fileId: 'file-latest',
          fileName: 'latest-report.pdf',
          downloadUrl: apiPath('submission-files/file-latest'),
        },
      ],
    },
    history,
  };
  return renderToStaticMarkup(
    <ReviewRevisionComparison
      context={context}
      original={original}
      needsAcknowledgement
      isRefreshing={false}
      disabled={false}
      refreshError={null}
    />,
  );
}

describe('review comparison file availability', () => {
  it('keeps original names and text but removes unavailable old links with a reason', () => {
    const html = renderComparison([{ ...original, files: [] }]);
    expect(html).toContain('original-report.pdf');
    expect(html).toContain('처음 검토한 글');
    expect(html).not.toContain(`href="${oldFile.downloadUrl}"`);
    expect(html).toContain('현재 제출 이력에서 내려받을 수 없는 파일입니다.');
    expect(html).toContain(`href="${apiPath('submission-files/file-latest')}"`);
    expect(html).toContain('2026. 9. 1.');
    expect(html).toContain('2026. 9. 2.');
  });
  it('uses the latest history download metadata for an accessible original file', () => {
    const freshUrl = apiPath('submission-files/file-original-refreshed');
    const html = renderComparison([
      { ...original, files: [{ ...oldFile, downloadUrl: freshUrl }] },
    ]);
    expect(html).toContain(`href="${freshUrl}"`);
    expect(html).not.toContain(`href="${oldFile.downloadUrl}"`);
    expect(html).not.toContain(
      '현재 제출 이력에서 내려받을 수 없는 파일입니다.',
    );
  });
});
