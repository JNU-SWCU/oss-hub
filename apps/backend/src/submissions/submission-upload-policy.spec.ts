import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isAllowedSubmissionFileType } from './submission-file-content-type';
import { MAX_FILE_BYTES } from './submission-files.service';
import { PROGRAM_AUTHORING_UPLOAD_MAX_BYTES } from '../programs/program-authoring-upload.validation';
import {
  SUBMISSION_UPLOAD_ACCEPT,
  SUBMISSION_UPLOAD_FORMAT_LABEL,
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
  SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE,
} from './submission-upload-policy';

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
  const OWNER = join(SOURCE_ROOT, 'submissions', 'submission-upload-policy.ts');

  function sourceFiles(directory: string): readonly string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name.startsWith('__lint_fixture_')) return [];
      const full = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      if (!entry.name.endsWith('.ts')) return [];
      if (entry.name.endsWith('.spec.ts')) return [];
      return [full];
    });
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
