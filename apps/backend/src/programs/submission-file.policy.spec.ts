import {
  isAllowedSubmissionFileType,
  safeSubmissionFileContentType,
  hasValidSubmissionFileSignature,
  SUBMISSION_UPLOAD_ACCEPT,
  SUBMISSION_UPLOAD_FORMAT_LABEL,
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
  SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE,
} from './submission-file.policy';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { MAX_FILE_BYTES } from './submission-files.service';
import { PROGRAM_AUTHORING_UPLOAD_MAX_BYTES } from './program-authoring.policy';

describe('submission-file-content-type.policy', () => {
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
      expect(safeSubmissionFileContentType('report.pdf')).toBe(
        'application/pdf',
      );
      expect(safeSubmissionFileContentType('bundle.ZIP')).toBe(
        'application/zip',
      );
    });

    it.each([
      ['photo.jpg', 'image/jpeg'],
      ['photo.JPEG', 'image/jpeg'],
      ['image.png', 'image/png'],
    ])(
      'rejects new image uploads while preserving stored %s downloads',
      (name, mime) => {
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
});

describe('submission-file-signature.policy', () => {
  describe('new submission file signature policy', () => {
    it.each([
      ['photo.jpg', [0xff, 0xd8, 0xff]],
      ['photo.jpeg', [0xff, 0xd8, 0xff]],
      ['image.png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ])('rejects %s even when the image signature is valid', (name, bytes) => {
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
      expect(hasValidSubmissionFileSignature(bytes, name)).toBe(true);
    });
  });
});

describe('submission-upload.policy', () => {
  describe('submission upload policy', () => {
    it('상한은 5 MiB 그대로이고 표기만 「5 MB」다', () => {
      expect(SUBMISSION_UPLOAD_MAX_BYTES).toBe(5 * 1024 * 1024);
      expect(SUBMISSION_UPLOAD_MAX_LABEL).toBe('5 MB');
      expect(SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE).toBe(
        '파일은 5 MB 이하여야 합니다.',
      );
    });

    it('업로드 경로 셋이 같은 상한을 쓴다', () => {
      expect(MAX_FILE_BYTES).toBe(SUBMISSION_UPLOAD_MAX_BYTES);
      expect(PROGRAM_AUTHORING_UPLOAD_MAX_BYTES).toBe(
        SUBMISSION_UPLOAD_MAX_BYTES,
      );
    });

    it('accept 목록의 확장자는 모두 실제 입장 검사를 통과한다', () => {
      const extensions = SUBMISSION_UPLOAD_ACCEPT.split(',');
      expect(extensions.length).toBeGreaterThan(0);
      for (const extension of extensions) {
        expect(extension.startsWith('.')).toBe(true);
        expect(isAllowedSubmissionFileType(`파일${extension}`)).toBe(true);
      }
    });

    it('입장 검사가 막는 확장자는 accept 목록에 없다', () => {
      for (const extension of ['.exe', '.txt', '.docx', '.sh']) {
        expect(isAllowedSubmissionFileType(`파일${extension}`)).toBe(false);
        expect(SUBMISSION_UPLOAD_ACCEPT.split(',')).not.toContain(extension);
      }
    });

    it('형식 안내 문구는 accept 목록에서 만든다', () => {
      expect(SUBMISSION_UPLOAD_FORMAT_LABEL).toBe('PDF, HWP, ZIP');
      for (const label of SUBMISSION_UPLOAD_FORMAT_LABEL.split(', ')) {
        expect(SUBMISSION_UPLOAD_ACCEPT.toUpperCase()).toContain(`.${label}`);
      }
    });
  });

  describe('상한 리터럴이 정본 밖으로 다시 퍼지지 않는다', () => {
    const SOURCE_ROOT = resolve(__dirname, '..');
    const OWNER = join(SOURCE_ROOT, 'programs', 'submission-file.policy.ts');

    function sourceFiles(directory: string): readonly string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap(
        (entry) => {
          const full = join(directory, entry.name);
          if (entry.isDirectory()) return sourceFiles(full);
          if (!entry.name.endsWith('.ts')) return [];
          if (entry.name.endsWith('.spec.ts')) return [];
          return [full];
        },
      );
    }

    it('production 소스에서 5 MiB 리터럴을 쓰는 파일은 정본 하나뿐이다', () => {
      const offenders = sourceFiles(SOURCE_ROOT).filter(
        (file) =>
          file !== OWNER &&
          /5\s*\*\s*1024\s*\*\s*1024/.test(readFileSync(file, 'utf-8')),
      );
      expect(offenders.map((file) => relative(SOURCE_ROOT, file))).toEqual([]);
    });
  });
});
