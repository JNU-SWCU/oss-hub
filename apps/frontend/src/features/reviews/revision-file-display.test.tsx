import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { RevisionCard } from './components/revision-history';
import type { SubmissionRevision } from './types';

const CURRENT_FILE_DOWNLOAD_URL = apiPath('submission-files/file-current');
const EXTRA_FILE_DOWNLOAD_URL = apiPath('submission-files/file-extra');

function revision(overrides: Partial<SubmissionRevision>): SubmissionRevision {
  return {
    number: 1,
    content: { type: 'FILE', fileId: 'file-current' },
    comment: null,
    submittedAt: '2026-09-27T01:00:00.000Z',
    files: [],
    review: null,
    ...overrides,
  };
}

describe('RevisionCard file display', () => {
  it('does not render revision file links when file metadata is absent', () => {
    // Given
    const input = revision({});

    // When
    const html = renderToStaticMarkup(<RevisionCard revision={input} />);

    // Then
    expect(html).not.toContain('report.pdf');
    expect(html).not.toContain(CURRENT_FILE_DOWNLOAD_URL);
    // QA48 — FILE 유형인데 첨부까지 없으면 raw JSON 대신 짧은 안내를 보여준다.
    expect(html).toContain('파일 제출');
    expect(html).not.toContain('"type"');
    expect(html).not.toContain('"fileId"');
  });

  it('renders each attached file name, size, and download link', () => {
    // Given
    const input = revision({
      files: [
        {
          fileId: 'file-current',
          fileName: 'report.pdf',
          contentType: 'application/pdf',
          size: 1536,
          expiresAt: '2026-08-01T00:00:00.000Z',
          downloadUrl: CURRENT_FILE_DOWNLOAD_URL,
        },
        {
          fileId: 'file-extra',
          fileName: 'screenshots.zip',
          contentType: 'application/zip',
          size: 2_621_440,
          expiresAt: '2026-08-01T00:00:00.000Z',
          downloadUrl: EXTRA_FILE_DOWNLOAD_URL,
        },
      ],
    });

    // When
    const html = renderToStaticMarkup(<RevisionCard revision={input} />);

    // Then
    expect(html).toContain('report.pdf');
    expect(html).toContain('1.5 KB');
    expect(html).toContain(`href="${CURRENT_FILE_DOWNLOAD_URL}"`);
    expect(html).toContain('download="report.pdf"');
    expect(html).toContain('screenshots.zip');
    expect(html).toContain('2.5 MB');
    expect(html).toContain(`href="${EXTRA_FILE_DOWNLOAD_URL}"`);
    expect(html).toContain('download="screenshots.zip"');
  });
});
