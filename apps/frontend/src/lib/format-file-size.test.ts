import { describe, expect, it } from 'vitest';
import { formatFileSize } from './format-file-size';

describe('formatFileSize', () => {
  it.each([
    [512, '512 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1 MB'],
    [1572864, '1.5 MB'],
  ])(
    'formats %i bytes as %s without an unnecessary decimal',
    (bytes, expected) => {
      expect(formatFileSize(bytes)).toBe(expected);
    },
  );
});
