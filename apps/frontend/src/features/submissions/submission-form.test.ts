import { describe, expect, it, vi } from 'vitest';
import {
  getSubmissionFileErrorMessage,
  isStaleSubmissionFormErrorCode,
  SUBMISSION_FILE_MAX_BYTES,
  SubmissionFileUploadCache,
  validateSubmissionContent,
  validateSubmissionFile,
} from './submission-form';

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
    // Given
    const cache = new SubmissionFileUploadCache();
    const first = new File(['%PDF'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['%PDF'], 'second.pdf', {
      type: 'application/pdf',
    });
    const upload = vi
      .fn<() => Promise<{ fileId: string }>>()
      .mockResolvedValueOnce({ fileId: 'file-first' })
      .mockResolvedValueOnce({ fileId: 'file-second' });

    // When
    await expect(cache.resolve(first, upload)).resolves.toBe('file-first');
    cache.discardUnless(second);
    await expect(cache.resolve(second, upload)).resolves.toBe('file-second');

    // Then
    expect(upload).toHaveBeenCalledTimes(2);
  });
});

describe('validateSubmissionFile', () => {
  it('파일 선택은 필수다', () => {
    expect(validateSubmissionFile(null)).toEqual({
      ok: false,
      message: '제출할 파일을 선택해 주세요.',
    });
  });

  it.each([
    ['document.PDF', 'application/pdf'],
    ['document.hwp', 'application/x-hwp'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.JPEG', 'image/jpeg'],
    ['image.png', 'image/png'],
    ['archive.zip', 'application/zip'],
  ])('%s와 %s 쌍을 허용한다', (name, type) => {
    expect(validateSubmissionFile(new File(['x'], name, { type }))).toEqual({
      ok: true,
    });
  });

  it.each([
    ['document.pdf', 'application/octet-stream'],
    ['document.txt', 'application/pdf'],
    ['document', 'application/pdf'],
    ['photo.jpg', 'image/png'],
  ])('%s와 %s의 잘못된 쌍을 거절한다', (name, type) => {
    expect(validateSubmissionFile(new File(['x'], name, { type }))).toEqual({
      ok: false,
      message: 'PDF, HWP, JPG, PNG, ZIP 파일만 제출할 수 있습니다.',
    });
  });

  it('정확히 50 MiB는 허용하고 1 byte 초과는 거절한다', () => {
    const boundary = {
      name: 'a.pdf',
      type: 'application/pdf',
      size: SUBMISSION_FILE_MAX_BYTES,
    } as File;
    const oversized = {
      name: 'a.pdf',
      type: 'application/pdf',
      size: SUBMISSION_FILE_MAX_BYTES + 1,
    } as File;

    expect(validateSubmissionFile(boundary)).toEqual({ ok: true });
    expect(validateSubmissionFile(oversized)).toEqual({
      ok: false,
      message: '파일 크기는 50 MiB를 초과할 수 없습니다.',
    });
  });
});

describe('getSubmissionFileErrorMessage', () => {
  it.each([
    ['SUB_017', '파일, 신청 ID, 마일스톤 ID를 올바르게 입력해 주세요.'],
    ['SUB_018', 'PDF, HWP, JPG, PNG, ZIP 파일만 제출할 수 있습니다.'],
    ['SUB_019', '파일 크기는 50 MiB를 초과할 수 없습니다.'],
    [
      'SUB_020',
      '파일 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    ],
    ['SUB_021', '프로그램 종료일이 설정된 후 파일을 제출할 수 있습니다.'],
  ])('%s를 안정적인 사용자 메시지로 매핑한다', (code, message) => {
    expect(getSubmissionFileErrorMessage(code)).toBe(message);
  });

  it('알 수 없는 코드는 서버 메시지를 노출하지 않는다', () => {
    expect(getSubmissionFileErrorMessage('UNKNOWN')).toBeNull();
  });
});

describe('validateSubmissionContent', () => {
  it('TEXT는 공백만 있는 제출을 거절하고 입력값은 유지한다', () => {
    // Given
    const input = { file: null, text: '   ', releaseUrl: '' };

    // When
    const errors = validateSubmissionContent('TEXT', input);

    // Then
    expect(errors).toEqual({ text: '제출 내용을 입력해 주세요.' });
    expect(input.text).toBe('   ');
  });

  it('REPOSITORY_RELEASE는 http URL이 아니면 field 오류를 반환한다', () => {
    // Given
    const input = { file: null, text: '', releaseUrl: 'not-a-url' };

    // When
    const errors = validateSubmissionContent('REPOSITORY_RELEASE', input);

    // Then
    expect(errors).toEqual({
      releaseUrl: '태그 또는 릴리스의 전체 URL을 입력해 주세요.',
    });
  });

  it('연결 저장소의 URL 형태는 서버 검증을 위해 통과시킨다', () => {
    // Given
    const input = {
      file: null,
      text: '',
      releaseUrl:
        'https://github.com/JNU-SWCU/synthetic-repository/releases/tag/v1.0.0',
    };

    // When
    const errors = validateSubmissionContent('REPOSITORY_RELEASE', input);

    // Then
    expect(errors).toEqual({});
  });
});
