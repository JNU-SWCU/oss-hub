import { PROGRAM_COVER_MAX_BYTES } from './submission-upload.config';
import { ProgramAuthoringUploadLifecycle } from '@prisma/client';
import type { ProgramAuthoringUploadFile } from './program-authoring-upload.error';
import { type ProgramAuthoringUploadToken } from './program-authoring-upload.config';
import { ProgramCoverUrlService } from './program-cover-url.service';
import { ProgramUploadRulesService } from './program-upload-rules.service';
import { SubmissionFileRulesService } from './submission-file-rules.service';

const programCoverUrlService = new ProgramCoverUrlService();
const programUploadRulesService = new ProgramUploadRulesService(
  new SubmissionFileRulesService(),
);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXuoAAAAASUVORK5CYII=',
  'base64',
);

function file(
  overrides: Partial<ProgramAuthoringUploadFile> = {},
): ProgramAuthoringUploadFile {
  return {
    buffer: PNG,
    originalname: 'cover.png',
    mimetype: 'image/png',
    size: PNG.length,
    ...overrides,
  };
}

function upload(
  overrides: Partial<ProgramAuthoringUploadToken> = {},
): ProgramAuthoringUploadToken {
  return {
    id: 'cover-upload',
    actorId: 'staff',
    lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
    unexpired: true,
    storageKey: 'program-covers/image',
    originalFileName: 'cover.png',
    mimeType: 'image/png',
    sizeBytes: PNG.length,
    ...overrides,
  };
}

describe('program cover policy', () => {
  it('accepts actual PNG bytes and normalizes the original name', () => {
    expect(
      programUploadRulesService.validateProgramCoverUpload(
        file({ originalname: 'folder/COVER.PNG' }),
      ),
    ).toMatchObject({
      body: PNG,
      originalFileName: 'COVER.PNG',
      mimeType: 'image/png',
      sizeBytes: PNG.length,
    });
  });

  it.each(['.jpg', '.jpeg'])(
    'requires the JPEG signature for %s',
    (extension) => {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
      expect(
        programUploadRulesService.validateProgramCoverUpload(
          file({
            buffer,
            size: buffer.length,
            originalname: `cover${extension}`,
            mimetype: 'image/jpeg',
          }),
        ).mimeType,
      ).toBe('image/jpeg');
    },
  );

  it.each([
    file({ mimetype: 'text/html' }),
    file({ originalname: 'cover.svg', mimetype: 'image/svg+xml' }),
    file({ originalname: 'cover.jpg', mimetype: 'image/jpeg' }),
    file({ buffer: Buffer.alloc(PNG.length) }),
    file({ originalname: 'cover.pdf', mimetype: 'application/pdf' }),
  ])('rejects mismatched or unsupported image content', (value) => {
    expect(() =>
      programUploadRulesService.validateProgramCoverUpload(value),
    ).toThrow('PROGRAM_AUTHORING_UPLOAD_UNSUPPORTED_FILE_TYPE');
  });

  it.each([
    undefined,
    file({ buffer: Buffer.alloc(0), size: 0 }),
    file({ size: PNG.length + 1 }),
  ])('rejects empty or inconsistent input', (value) => {
    expect(() =>
      programUploadRulesService.validateProgramCoverUpload(value),
    ).toThrow('PROGRAM_AUTHORING_UPLOAD_INVALID_FILE');
  });

  it('accepts exactly 5 MiB and rejects the next byte', () => {
    const buffer = Buffer.alloc(PROGRAM_COVER_MAX_BYTES);
    PNG.copy(buffer);
    expect(
      programUploadRulesService.validateProgramCoverUpload(
        file({ buffer, size: buffer.length }),
      ).sizeBytes,
    ).toBe(PROGRAM_COVER_MAX_BYTES);
    const oversized = Buffer.concat([buffer, Buffer.from([0])]);
    expect(() =>
      programUploadRulesService.validateProgramCoverUpload(
        file({ buffer: oversized, size: oversized.length }),
      ),
    ).toThrow('PROGRAM_AUTHORING_UPLOAD_FILE_TOO_LARGE');
  });

  it('keeps document and cover upload tokens mutually exclusive', () => {
    expect(() =>
      programUploadRulesService.assertProgramCoverUpload(upload()),
    ).not.toThrow();
    expect(() =>
      programUploadRulesService.assertProgramCoverUpload(
        upload({ storageKey: 'program-authoring/private-image' }),
      ),
    ).toThrow();
    expect(() =>
      programUploadRulesService.assertProgramCoverUpload(
        upload({ mimeType: 'application/pdf' }),
      ),
    ).toThrow();
    expect(() =>
      programUploadRulesService.assertProgramTemplateUpload(upload()),
    ).toThrow();
    expect(() =>
      programUploadRulesService.assertProgramTemplateUpload(
        upload({ storageKey: 'program-authoring/document' }),
      ),
    ).not.toThrow();
  });

  it('returns null without a cover and encodes both path segments', () => {
    expect(
      programCoverUrlService.programCoverImageUrl('program', null),
    ).toBeNull();
    expect(
      programCoverUrlService.programCoverImageUrl('program/name', 'cover/id'),
    ).toBe('/programs/program%2Fname/cover/cover%2Fid');
  });
});
