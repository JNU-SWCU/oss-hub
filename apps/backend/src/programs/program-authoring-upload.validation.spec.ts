import { createHash } from 'node:crypto';
import {
  PROGRAM_AUTHORING_UPLOAD_ERROR_CODES,
  type ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
} from './program-authoring-upload.types';
import {
  PROGRAM_AUTHORING_UPLOAD_MAX_BYTES,
  validateProgramAuthoringUpload,
} from './program-authoring-upload.validation';
import { signatureValidZip } from '../submissions/submission-zip-test-builder';

function file(input: {
  readonly name: string;
  readonly mimeType: string;
  readonly signature: Buffer;
  readonly actualSize?: number;
  readonly declaredSize?: number;
}): ProgramAuthoringUploadFile {
  const actualSize = input.actualSize ?? 32;
  const buffer = Buffer.alloc(actualSize);
  input.signature.copy(buffer);
  return {
    buffer,
    originalname: input.name,
    mimetype: input.mimeType,
    size: input.declaredSize ?? actualSize,
  };
}

describe('validateProgramAuthoringUpload', () => {
  it.each([
    ['plan.pdf', 'application/pdf', Buffer.from('%PDF-')],
    [
      'plan.hwp',
      'application/x-hwp',
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    ],
    ['photo.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff])],
    [
      'diagram.png',
      'image/png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
  ])(
    'accepts a matching extension, MIME, and signature for %s',
    async (name, mimeType, signature) => {
      // Given
      const upload = file({ name, mimeType, signature });

      // When
      const validated = await validateProgramAuthoringUpload(upload);

      // Then
      expect(validated).toMatchObject({
        originalFileName: name,
        mimeType,
        sizeBytes: upload.buffer.byteLength,
        sha256: createHash('sha256').update(upload.buffer).digest('hex'),
      });
    },
  );

  /**
   * .zip은 서명만으로 받지 않는다 — 중앙 디렉터리까지 읽혀 입장 검사를 통과해야 한다.
   * 그래서 상수 `PK\x03\x04` + 0으로 채운 버퍼는 더 이상 유효한 입력이 아니다.
   */
  it('accepts a real zip whose central directory passes archive admission', async () => {
    // Given
    const archive = signatureValidZip([{ name: 'plan.pdf' }]);

    // When
    const validated = await validateProgramAuthoringUpload({
      buffer: archive,
      originalname: 'bundle.zip',
      mimetype: 'application/zip',
      size: archive.byteLength,
    });

    // Then
    expect(validated).toMatchObject({
      originalFileName: 'bundle.zip',
      mimeType: 'application/zip',
      sizeBytes: archive.byteLength,
      sha256: createHash('sha256').update(archive).digest('hex'),
    });
  });

  it('rejects a zip whose metadata fails archive admission', async () => {
    // Given: 서명은 진짜 집이지만 안에 또 다른 집이 들어 있다(중첩 아카이브).
    const nested = signatureValidZip([{ name: 'nested.zip' }]);

    // When / Then
    await expect(
      validateProgramAuthoringUpload({
        buffer: nested,
        originalname: 'bundle.zip',
        mimetype: 'application/zip',
        size: nested.byteLength,
      }),
    ).rejects.toMatchObject({
      code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    });
  });

  it('rejects a zip signature that is not a parseable archive', async () => {
    // Given: 예전 fixture — `PK\x03\x04` 뒤가 전부 0이라 중앙 디렉터리가 없다.
    const upload = file({
      name: 'bundle.zip',
      mimeType: 'application/zip',
      signature: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    });

    // When / Then
    await expect(validateProgramAuthoringUpload(upload)).rejects.toMatchObject({
      code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    });
  });

  it('restores a multipart latin1 mojibake filename before validating it', async () => {
    const mojibake = Buffer.from('신청-양식.pdf', 'utf8').toString('latin1');

    await expect(
      validateProgramAuthoringUpload(
        file({
          name: mojibake,
          mimeType: 'application/pdf',
          signature: Buffer.from('%PDF-'),
        }),
      ),
    ).resolves.toMatchObject({ originalFileName: '신청-양식.pdf' });
  });

  it('accepts the exact 5 MiB boundary using the actual buffer length', async () => {
    // Given
    const upload = file({
      name: 'maximum.pdf',
      mimeType: 'application/pdf',
      signature: Buffer.from('%PDF-'),
      actualSize: PROGRAM_AUTHORING_UPLOAD_MAX_BYTES,
    });

    // When
    const validated = await validateProgramAuthoringUpload(upload);

    // Then
    expect(validated.sizeBytes).toBe(5 * 1024 * 1024);
  });

  it.each([
    [
      'an empty file',
      file({
        name: 'empty.pdf',
        mimeType: 'application/pdf',
        signature: Buffer.alloc(0),
        actualSize: 0,
      }),
    ],
    [
      'a declared/actual size mismatch',
      file({
        name: 'mismatch.pdf',
        mimeType: 'application/pdf',
        signature: Buffer.from('%PDF-'),
        actualSize: 32,
        declaredSize: 31,
      }),
    ],
  ])('rejects %s', async (_caseName, upload) => {
    // When / Then
    await expect(validateProgramAuthoringUpload(upload)).rejects.toEqual(
      expect.objectContaining<Pick<ProgramAuthoringUploadError, 'code'>>({
        code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_FILE,
      }),
    );
  });

  it('rejects one byte over 5 MiB even when the declared size matches', async () => {
    // Given
    const upload = file({
      name: 'oversize.pdf',
      mimeType: 'application/pdf',
      signature: Buffer.from('%PDF-'),
      actualSize: PROGRAM_AUTHORING_UPLOAD_MAX_BYTES + 1,
    });

    // When / Then
    await expect(validateProgramAuthoringUpload(upload)).rejects.toEqual(
      expect.objectContaining<Pick<ProgramAuthoringUploadError, 'code'>>({
        code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.FILE_TOO_LARGE,
      }),
    );
  });

  it.each([
    ['plan.exe', 'application/pdf', Buffer.from('%PDF-')],
    ['plan.pdf', 'text/html', Buffer.from('%PDF-')],
    ['plan.pdf', 'application/pdf', Buffer.from('not-pdf')],
  ])(
    'rejects an unsupported extension/MIME/signature combination',
    async (name, mimeType, signature) => {
      // Given
      const upload = file({ name, mimeType, signature });

      // When / Then
      await expect(validateProgramAuthoringUpload(upload)).rejects.toEqual(
        expect.objectContaining<Pick<ProgramAuthoringUploadError, 'code'>>({
          code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
        }),
      );
    },
  );
});
