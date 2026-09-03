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
    ['document.hwp', ''],
    ['photo.jpg', 'image/png'],
    ['archive.zip', 'application/x-zip-compressed'],
    ['archive.zip', 'application/octet-stream'],
  ])('허용 확장자 %s는 브라우저 MIME %s와 무관하게 통과한다', (name, type) => {
    const file = new File(['x'], name, { type });

    expect(validateSubmissionFile(file)).toEqual({
      ok: true,
    });
  });

  it.each(['document.txt', 'document', 'photo.exe'])(
    '허용하지 않는 이름 %s는 거절한다',
    (name) => {
      expect(
        validateSubmissionFile(
          new File(['x'], name, { type: 'application/pdf' }),
        ),
      ).toEqual({
        ok: false,
        message: 'PDF, HWP, JPG, PNG, ZIP 파일만 제출할 수 있습니다.',
      });
    },
  );

  it('정확히 5 MiB는 허용하고 1 byte 초과는 거절한다', () => {
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
      message: '파일은 5MiB 이하여야 합니다.',
    });
  });
});

describe('getSubmissionFileErrorMessage', () => {
  it.each([
    [
      'SUB_017',
      '제출 요청이 서버에 온전히 전달되지 않았습니다. 파일을 다시 선택해 제출해 보고, 그래도 안 되면 프로그램 상세에서 해당 마일스톤의 제출 화면을 다시 열어 주세요.',
    ],
    ['SUB_018', 'PDF, HWP, JPG, PNG, ZIP 파일만 제출할 수 있습니다.'],
    ['SUB_019', '파일은 5MiB 이하여야 합니다.'],
    [
      'SUB_020',
      '파일 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    ],
    [
      'SUB_021',
      '프로그램 종료일이 설정되지 않아 파일을 제출할 수 없습니다. 담당 교직원에게 확인해 주세요.',
    ],
  ])('%s를 안정적인 사용자 메시지로 매핑한다', (code, message) => {
    expect(getSubmissionFileErrorMessage(code)).toBe(message);
  });

  // #354 — 사용자가 만들지도 고치지도 못하는 값(신청 ID·마일스톤 ID)을 입력하라고
  // 지시하면 따를 방법이 없다. 화면을 다시 여는 행동만 제시해야 한다.
  it('SUB_017은 사용자가 고칠 수 없는 내부 식별자 입력을 요구하지 않는다', () => {
    const message = getSubmissionFileErrorMessage('SUB_017') ?? '';

    expect(message).not.toMatch(/신청 ID|마일스톤 ID/);
    expect(message).not.toMatch(/올바르게 입력/);
    expect(message).toContain('제출 화면을 다시 열어');
  });

  // #354 — SUB_017(INVALID_FILE_UPLOAD)의 백엔드 발생 조건은 파일 부분 누락,
  // 식별자 형식 오류, 회차 값 오류, multipart 한도 초과로 여러 갈래다. 그중
  // "만료"인 것은 하나도 없으므로 원인을 만료로 단정하면 틀린 안내가 된다.
  it('SUB_017은 원인을 만료로 단정하지 않고 파일 재선택을 먼저 제시한다', () => {
    const message = getSubmissionFileErrorMessage('SUB_017') ?? '';

    expect(message).not.toMatch(/만료/);
    // 파일 부분 누락이 실제 발생 조건이므로 학생이 바로 할 수 있는 행동이다.
    expect(message).toContain('파일을 다시 선택');
    // 식별자·회차 오류까지 덮는 두 번째 행동.
    expect(message).toContain('제출 화면을 다시 열어');
  });

  // #354 — 막힌 이유와 물어볼 대상이 없으면 학생이 다음 행동을 고를 수 없다.
  it('SUB_021은 막힌 이유와 문의 대상을 함께 알려준다', () => {
    const message = getSubmissionFileErrorMessage('SUB_021') ?? '';

    expect(message).toContain('프로그램 종료일이 설정되지 않아');
    expect(message).toContain('담당 교직원');
    // 옛 문구는 "설정된 후 제출할 수 있습니다"로 끝나 누구에게 물을지가 없었다.
    expect(message).not.toMatch(/설정된 후 파일을 제출할 수 있습니다/);
  });

  // #1106 — 상한을 50 MiB에서 5 MiB로 내렸을 때 문구만 옛 숫자로 남아, 학생이 절대
  // 통과할 수 없는 크기를 통과한다고 읽었다. 문구의 숫자는 실제로 막는 상한에서 온다.
  it('SUB_019 문구는 실제로 막는 상한과 같은 숫자를 말한다', () => {
    expect(getSubmissionFileErrorMessage('SUB_019')).toBe(
      `파일은 ${SUBMISSION_FILE_MAX_BYTES / 1024 / 1024}MiB 이하여야 합니다.`,
    );
  });

  it('알 수 없는 코드는 서버 메시지를 노출하지 않는다', () => {
    expect(getSubmissionFileErrorMessage('UNKNOWN')).toBeNull();
  });
});

describe('validateSubmissionContent', () => {
  it('TEXT는 공백만 있는 제출을 거절하고 입력값은 유지한다', () => {
    // Given
    const input = { file: null, text: '   ' };

    // When
    const errors = validateSubmissionContent('TEXT', input);

    // Then
    expect(errors).toEqual({ text: '제출 내용을 입력해 주세요.' });
    expect(input.text).toBe('   ');
  });
});
