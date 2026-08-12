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
    ['bundle.zip', 'application/zip', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  ])(
    'accepts a matching extension, MIME, and signature for %s',
    (name, mimeType, signature) => {
      // Given
      const upload = file({ name, mimeType, signature });

      // When
      const validated = validateProgramAuthoringUpload(upload);

      // Then
      expect(validated).toMatchObject({
        originalFileName: name,
        mimeType,
        sizeBytes: upload.buffer.byteLength,
        sha256: createHash('sha256').update(upload.buffer).digest('hex'),
      });
    },
  );

  it('restores a multipart latin1 mojibake filename before validating it', () => {
    const mojibake = Buffer.from('신청-양식.pdf', 'utf8').toString('latin1');

    expect(
      validateProgramAuthoringUpload(
        file({
          name: mojibake,
          mimeType: 'application/pdf',
          signature: Buffer.from('%PDF-'),
        }),
      ),
    ).toMatchObject({ originalFileName: '신청-양식.pdf' });
  });

  it('accepts the exact 5 MiB boundary using the actual buffer length', () => {
    // Given
    const upload = file({
      name: 'maximum.pdf',
      mimeType: 'application/pdf',
      signature: Buffer.from('%PDF-'),
      actualSize: PROGRAM_AUTHORING_UPLOAD_MAX_BYTES,
    });

    // When
    const validated = validateProgramAuthoringUpload(upload);

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
  ])('rejects %s', (_caseName, upload) => {
    // When / Then
    expect(() => validateProgramAuthoringUpload(upload)).toThrow(
      expect.objectContaining<Pick<ProgramAuthoringUploadError, 'code'>>({
        code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_FILE,
      }) as Error,
    );
  });

  it('rejects one byte over 5 MiB even when the declared size matches', () => {
    // Given
    const upload = file({
      name: 'oversize.pdf',
      mimeType: 'application/pdf',
      signature: Buffer.from('%PDF-'),
      actualSize: PROGRAM_AUTHORING_UPLOAD_MAX_BYTES + 1,
    });

    // When / Then
    expect(() => validateProgramAuthoringUpload(upload)).toThrow(
      expect.objectContaining<Pick<ProgramAuthoringUploadError, 'code'>>({
        code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.FILE_TOO_LARGE,
      }) as Error,
    );
  });

  it.each([
    ['plan.exe', 'application/pdf', Buffer.from('%PDF-')],
    ['plan.pdf', 'text/html', Buffer.from('%PDF-')],
    ['plan.pdf', 'application/pdf', Buffer.from('not-pdf')],
  ])(
    'rejects an unsupported extension/MIME/signature combination',
    (name, mimeType, signature) => {
      // Given
      const upload = file({ name, mimeType, signature });

      // When / Then
      expect(() => validateProgramAuthoringUpload(upload)).toThrow(
        expect.objectContaining<Pick<ProgramAuthoringUploadError, 'code'>>({
          code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
        }) as Error,
      );
    },
  );
});
