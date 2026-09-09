import {
  isAllowedSubmissionFileType,
  safeSubmissionFileContentType,
} from './submission-file-content-type';

describe('submission file content type policy', () => {
  it.each(['report.PDF', 'report.hwp', 'archive.zip'])(
    'accepts the allowed extension in %s',
    (fileName) => {
      expect(isAllowedSubmissionFileType(fileName)).toBe(true);
    },
  );

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

  it.each([
    ['photo.jpg', 'image/jpeg'],
    ['photo.JPEG', 'image/jpeg'],
    ['image.png', 'image/png'],
  ])(
    'rejects new image uploads while preserving stored %s downloads',
    (name, mime) => {
      // Given / When / Then: 새 업로드 정책은 기존 첨부의 다운로드 타입을 바꾸지 않는다.
      expect(isAllowedSubmissionFileType(name)).toBe(false);
      expect(safeSubmissionFileContentType(name)).toBe(mime);
    },
  );

  it('falls back to octet-stream when the extension is not allowed', () => {
    expect(safeSubmissionFileContentType('report.html')).toBe(
      'application/octet-stream',
    );
  });
});
