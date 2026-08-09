import {
  isAllowedSubmissionFileType,
  safeSubmissionFileContentType,
} from './submission-file-content-type';

describe('submission file content type policy', () => {
  it('accepts only a matching extension and MIME pair', () => {
    expect(isAllowedSubmissionFileType('report.PDF', 'APPLICATION/PDF')).toBe(
      true,
    );
    expect(isAllowedSubmissionFileType('report.pdf', 'text/html')).toBe(false);
  });

  it.each([
    'application/haansofthwp',
    'application/vnd.hancom.hwp',
    'application/x-hwp-v5',
    'application/octet-stream',
  ])('accepts the HWP MIME alias %s', (mimeType) => {
    // Given / When / Then
    expect(isAllowedSubmissionFileType('report.hwp', mimeType)).toBe(true);
  });

  it('rejects an executable MIME even when the extension is HWP', () => {
    // Given / When / Then
    expect(isAllowedSubmissionFileType('report.hwp', 'text/html')).toBe(false);
  });

  it('falls back to octet-stream when stored metadata does not match policy', () => {
    expect(safeSubmissionFileContentType('report.pdf', 'text/html')).toBe(
      'application/octet-stream',
    );
    expect(safeSubmissionFileContentType('report.pdf', 'application/pdf')).toBe(
      'application/pdf',
    );
  });
});
