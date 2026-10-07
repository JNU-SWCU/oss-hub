import { submissionUploadLimit } from '../../../test-support/submission-upload-limit';
import { describe, expect, it, vi } from 'vitest';
import {
  getSubmissionFileErrorMessage,
  isStaleSubmissionFormErrorCode,
  isSubmissionArchiveErrorCode,
  SUBMISSION_ARCHIVE_ERROR_CODES,
  SubmissionFileUploadCache,
  validateSubmissionContent,
  validateSubmissionFile,
} from './submission-form';

const policy = submissionUploadLimit();

describe('isStaleSubmissionFormErrorCode', () => {
  it.each(['SUB_005', 'SUB_006'])(
    '%s는 서버 기준 제출 상태를 다시 조회한다',
    (code) => {
      expect(isStaleSubmissionFormErrorCode(code)).toBe(true);
    },
  );

  it('field 오류는 현재 입력 폼에서 처리한다', () => {
    expect(isStaleSubmissionFormErrorCode('SUB_009')).toBe(false);
  });
});
describe('SubmissionFileUploadCache', () => {
  it.each(['SUB_005', 'SUB_006'])(
    '%s 이후 같은 파일도 새 ID로 다시 업로드한다',
    async (code) => {
      const cache = new SubmissionFileUploadCache();
      const file = new File(['%PDF'], 'submission.pdf', {
        type: 'application/pdf',
      });
      const upload = vi
        .fn<() => Promise<{ fileId: string }>>()
        .mockResolvedValueOnce({ fileId: 'file-old' })
        .mockResolvedValueOnce({ fileId: 'file-new' });

      await expect(cache.resolve(file, upload)).resolves.toBe('file-old');
      if (isStaleSubmissionFormErrorCode(code)) cache.discard();
      await expect(cache.resolve(file, upload)).resolves.toBe('file-new');

      expect(upload).toHaveBeenCalledTimes(2);
    },
  );

  it('file change invalidates only the previous selected file upload', async () => {
    const cache = new SubmissionFileUploadCache();
    const first = new File(['%PDF'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['%PDF'], 'second.pdf', {
      type: 'application/pdf',
    });
    const upload = vi
      .fn<() => Promise<{ fileId: string }>>()
      .mockResolvedValueOnce({ fileId: 'file-first' })
      .mockResolvedValueOnce({ fileId: 'file-second' });

    await expect(cache.resolve(first, upload)).resolves.toBe('file-first');
    cache.discardUnless(second);
    await expect(cache.resolve(second, upload)).resolves.toBe('file-second');

    expect(upload).toHaveBeenCalledTimes(2);
  });
});

describe('validateSubmissionFile', () => {
  it('서버가 내려준 2 MB 상한을 1바이트 넘으면 서버 표기로 거절한다', () => {
    const serverPolicy = submissionUploadLimit({
      maxBytes: 2 * 1024 * 1024,
      maxLabel: '2 MB',
    });
    const file = new File(
      [new Uint8Array(serverPolicy.maxBytes + 1)],
      'report.pdf',
    );
    const result = validateSubmissionFile(file, serverPolicy);
    expect(result).toEqual({
      ok: false,
      message: '파일은 2 MB 이하여야 합니다.',
    });
  });

  it('서버 상한과 같은 크기는 허용한다', () => {
    const serverPolicy = submissionUploadLimit({
      maxBytes: 2 * 1024 * 1024,
      maxLabel: '2 MB',
    });
    const file = new File(
      [new Uint8Array(serverPolicy.maxBytes)],
      'report.pdf',
    );
    expect(validateSubmissionFile(file, serverPolicy)).toEqual({ ok: true });
  });
  it('파일 선택은 필수다', () => {
    expect(validateSubmissionFile(null, policy)).toEqual({
      ok: false,
      message: '제출할 파일을 선택해 주세요.',
    });
  });

  it.each([
    ['document.PDF', 'application/pdf'],
    ['document.hwp', ''],
    ['archive.zip', 'application/x-zip-compressed'],
    ['archive.zip', 'application/octet-stream'],
  ])('허용 확장자 %s는 브라우저 MIME %s와 무관하게 통과한다', (name, type) => {
    const file = new File(['x'], name, { type });

    expect(validateSubmissionFile(file, policy)).toEqual({
      ok: true,
    });
  });

  it.each([
    'document.txt',
    'document',
    'photo.exe',
    'photo.jpg',
    'photo.jpeg',
    'image.png',
  ])('허용하지 않는 이름 %s는 거절한다', (name) => {
    expect(
      validateSubmissionFile(
        new File(['x'], name, { type: 'application/pdf' }),
        policy,
      ),
    ).toEqual({
      ok: false,
      message: 'PDF, HWP, ZIP 파일만 제출할 수 있습니다.',
    });
  });

  it('정확히 5 MiB는 허용하고 1 byte 초과는 거절한다', () => {
    const boundary = {
      name: 'a.pdf',
      type: 'application/pdf',
      size: policy.maxBytes,
    } as File;
    const oversized = {
      name: 'a.pdf',
      type: 'application/pdf',
      size: policy.maxBytes + 1,
    } as File;

    expect(validateSubmissionFile(boundary, policy)).toEqual({ ok: true });
    expect(validateSubmissionFile(oversized, policy)).toEqual({
      ok: false,
      message: '파일은 5 MB 이하여야 합니다.',
    });
  });
});

describe('getSubmissionFileErrorMessage', () => {
  it.each([
    [
      'SUB_017',
      '제출 요청이 서버에 온전히 전달되지 않았습니다. 파일을 다시 선택해 제출해 보고, 그래도 안 되면 프로그램 상세에서 해당 마일스톤의 제출 화면을 다시 열어 주세요.',
    ],
    ['SUB_018', 'PDF, HWP, ZIP 파일만 제출할 수 있습니다.'],
    ['SUB_019', '파일은 5 MB 이하여야 합니다.'],
    [
      'SUB_020',
      '파일 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    ],
    [
      'SUB_021',
      '프로그램 종료일이 설정되지 않아 파일을 제출할 수 없습니다. 담당 교직원에게 확인해 주세요.',
    ],
  ])('%s를 안정적인 사용자 메시지로 매핑한다', (code, message) => {
    expect(getSubmissionFileErrorMessage(code, policy)).toBe(message);
  });

  it('SUB_017은 사용자가 고칠 수 없는 내부 식별자 입력을 요구하지 않는다', () => {
    const message = getSubmissionFileErrorMessage('SUB_017', policy) ?? '';

    expect(message).not.toMatch(/신청 ID|마일스톤 ID/);
    expect(message).not.toMatch(/올바르게 입력/);
    expect(message).toContain('제출 화면을 다시 열어');
  });

  it('SUB_017은 원인을 만료로 단정하지 않고 파일 재선택을 먼저 제시한다', () => {
    const message = getSubmissionFileErrorMessage('SUB_017', policy) ?? '';

    expect(message).not.toMatch(/만료/);

    expect(message).toContain('파일을 다시 선택');

    expect(message).toContain('제출 화면을 다시 열어');
  });

  it('SUB_021은 막힌 이유와 문의 대상을 함께 알려준다', () => {
    const message = getSubmissionFileErrorMessage('SUB_021', policy) ?? '';

    expect(message).toContain('프로그램 종료일이 설정되지 않아');
    expect(message).toContain('담당 교직원');

    expect(message).not.toMatch(/설정된 후 파일을 제출할 수 있습니다/);
  });

  it('SUB_019 문구는 실제로 막는 상한과 같은 숫자를 말한다', () => {
    expect(getSubmissionFileErrorMessage('SUB_019', policy)).toBe(
      `파일은 ${policy.maxBytes / 1024 / 1024} MB 이하여야 합니다.`,
    );
  });

  it('알 수 없는 코드는 서버 메시지를 노출하지 않는다', () => {
    expect(getSubmissionFileErrorMessage('UNKNOWN', policy)).toBeNull();
  });
});

describe('압축 파일 내용 거절 코드', () => {
  const archiveCodes = [...SUBMISSION_ARCHIVE_ERROR_CODES];

  it.each(archiveCodes)('%s는 압축 내용 거절로 알아본다', (code) => {
    expect(isSubmissionArchiveErrorCode(code)).toBe(true);
  });

  it.each(archiveCodes)('%s에 형식 안내 문구를 붙이지 않는다', (code) => {
    expect(getSubmissionFileErrorMessage(code, policy)).not.toBe(
      'PDF, HWP, ZIP 파일만 제출할 수 있습니다.',
    );

    expect(getSubmissionFileErrorMessage(code, policy)).toBeNull();
  });

  it.each(['SUB_017', 'SUB_018', 'SUB_019', 'SUB_020', 'SUB_021', 'UNKNOWN'])(
    '%s는 압축 내용 거절이 아니다',
    (code) => {
      expect(isSubmissionArchiveErrorCode(code)).toBe(false);
    },
  );
});

describe('validateSubmissionContent', () => {
  it('TEXT는 공백만 있는 제출을 거절하고 입력값은 유지한다', () => {
    const input = { file: null, text: '   ' };

    const errors = validateSubmissionContent('TEXT', input, policy);

    expect(errors).toEqual({ text: '제출 내용을 입력해 주세요.' });
    expect(input.text).toBe('   ');
  });
});
