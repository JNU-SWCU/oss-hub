import { randomUUID } from 'node:crypto';
import {
  createSubmissionFileObjectKey,
  sanitizeSubmissionFileOriginalName,
} from './submission-file-object-key';

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}));

describe('submission file object policy', () => {
  it('creates opaque keys without leaking filenames', () => {
    jest
      .mocked(randomUUID)
      .mockReturnValueOnce('3b7985fb-59fc-4330-8299-ea8dadb975d1')
      .mockReturnValueOnce('0d52cb2d-fd90-4ae9-b7ca-0b5bc42f234a');

    expect(createSubmissionFileObjectKey()).toBe(
      'submission-files/3b7985fb-59fc-4330-8299-ea8dadb975d1',
    );
    expect(createSubmissionFileObjectKey()).toBe(
      'submission-files/0d52cb2d-fd90-4ae9-b7ca-0b5bc42f234a',
    );
  });

  it.each([
    ['../unsafe/report.pdf', 'report.pdf'],
    ['C:\\unsafe\\ report.pdf ', 'report.pdf'],
    ['a\u0000b\u001fc\u007f.pdf', 'abc.pdf'],
    ['', 'file'],
    ['.', 'file'],
    ['..', 'file'],
    ['folder/', 'file'],
    ['한글.pdf', '한글.pdf'],
    ['a'.repeat(256), 'a'.repeat(255)],
  ])('normalizes %j to its safe basename', (input, expected) => {
    expect(sanitizeSubmissionFileOriginalName(input)).toBe(expected);
  });
});
