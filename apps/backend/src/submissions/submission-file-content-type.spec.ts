import {
  isAllowedSubmissionFileType,
  safeSubmissionFileContentType,
} from './submission-file-content-type';

describe('submission file content type policy', () => {
  it.each([
    'report.PDF',
    'report.hwp',
    'photo.jpg',
    'image.png',
    'archive.zip',
  ])('accepts the allowed extension in %s', (fileName) => {
    expect(isAllowedSubmissionFileType(fileName)).toBe(true);
  });

  it.each(['report.exe', 'report', '.pdf', 'notes.txt'])(
    'rejects the unsupported name %s',
    (fileName) => {
      expect(isAllowedSubmissionFileType(fileName)).toBe(false);
    },
  );

  it('maps an allowed extension to its canonical download type', () => {
    expect(safeSubmissionFileContentType('report.pdf')).toBe('application/pdf');
    expect(safeSubmissionFileContentType('bundle.ZIP')).toBe('application/zip');
  });

  it('falls back to octet-stream when the extension is not allowed', () => {
    expect(safeSubmissionFileContentType('report.html')).toBe(
      'application/octet-stream',
    );
  });
});
