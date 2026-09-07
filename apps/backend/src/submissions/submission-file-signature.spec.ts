import { hasValidSubmissionFileSignature } from './submission-file-signature';

describe('new submission file signature policy', () => {
  it.each([
    ['photo.jpg', [0xff, 0xd8, 0xff]],
    ['photo.jpeg', [0xff, 0xd8, 0xff]],
    ['image.png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ])('rejects %s even when the image signature is valid', (name, bytes) => {
    // Given / When / Then
    expect(hasValidSubmissionFileSignature(Buffer.from(bytes), name)).toBe(
      false,
    );
  });

  it.each([
    ['report.pdf', Buffer.from('%PDF-')],
    [
      'report.hwp',
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    ],
    ['report.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  ])('keeps the supported %s signature', (name, bytes) => {
    // Given / When / Then
    expect(hasValidSubmissionFileSignature(bytes, name)).toBe(true);
  });
});
