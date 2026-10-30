import { ProgramTrackType } from '@prisma/client';
import {
  type ProgramAuthoringRequest,
  canonicalProgramAuthoringPayload,
  hashProgramAuthoringPayload,
  PROGRAM_AUTHORING_UPLOAD_MAX_BYTES,
  validateProgramAuthoringUpload,
} from './program-authoring.policy';
import { buildProgramAuthoringPlan } from './program-authoring-plan.policy';
import { createHash } from 'node:crypto';
import {
  PROGRAM_AUTHORING_UPLOAD_ERROR_CODES,
  type ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
} from './program-authoring-upload.error';
import { signatureValidZip } from './submission-zip-builder.fixture';

describe('program-authoring-payload-hash.policy', () => {
  function request(): ProgramAuthoringRequest {
    return {
      name: ' Program ',
      organizer: ' Organizer ',
      trackType: ProgramTrackType.CURRICULAR,
      applicationStartAt: '2026-08-01T09:00:00+09:00',
      applicationEndAt: '2026-08-10T09:00:00+09:00',
      endAt: '2026-09-01T09:00:00+09:00',
      description: ' Description ',
      milestones: [
        {
          name: ' First ',
          dueAt: '2026-08-20T09:00:00+09:00',
          documents: [
            {
              name: ' File ',
              required: true,
              templateUploadId: ' upload-1 ',
            },
            {
              name: ' Text ',
              required: false,
              templateUploadId: ' upload-2 ',
            },
          ],
        },
        {
          name: ' Second ',
          dueAt: '2026-08-25T09:00:00+09:00',
          documents: [
            {
              name: ' Summary ',
              required: true,
              templateUploadId: ' upload-3 ',
            },
          ],
        },
      ],
    };
  }

  describe('Program authoring canonical payload hash', () => {
    it('distinguishes curricular and extracurricular creation requests', () => {
      const curricular = buildProgramAuthoringPlan(request());
      const extracurricular = buildProgramAuthoringPlan({
        ...request(),
        trackType: ProgramTrackType.EXTRACURRICULAR,
      });

      expect(hashProgramAuthoringPayload(curricular)).not.toBe(
        hashProgramAuthoringPayload(extracurricular),
      );
    });

    it('includes both external source and image in the idempotency payload', () => {
      const externalCover = {
        sourceUrl:
          'https://sojoong.kr/notice/notice-board/?uid=123&mod=document',
        imageUrl: 'https://sojoong.kr/wp-content/uploads/synthetic.jpg',
      };
      const hash = (cover: typeof externalCover) =>
        hashProgramAuthoringPayload(
          buildProgramAuthoringPlan({ ...request(), externalCover: cover }),
        );
      expect(
        hash({
          ...externalCover,
          sourceUrl: externalCover.sourceUrl.replace('123', '124'),
        }),
      ).not.toBe(hash(externalCover));
      expect(
        hash({
          ...externalCover,
          imageUrl: externalCover.imageUrl.replace('synthetic', 'changed'),
        }),
      ).not.toBe(hash(externalCover));
      expect(
        hashProgramAuthoringPayload(
          buildProgramAuthoringPlan({ ...request(), externalCover: null }),
        ),
      ).toBe(hashProgramAuthoringPayload(buildProgramAuthoringPlan(request())));
    });
    it('normalizes no-cover requests and includes a selected cover token', () => {
      const original = buildProgramAuthoringPlan(request());
      const empty = buildProgramAuthoringPlan({
        ...request(),
        coverUploadId: null,
      });
      const covered = buildProgramAuthoringPlan({
        ...request(),
        coverUploadId: 'cover-upload',
      });
      expect(canonicalProgramAuthoringPayload(original)).not.toHaveProperty(
        'coverUploadId',
      );
      expect(hashProgramAuthoringPayload(empty)).toBe(
        hashProgramAuthoringPayload(original),
      );
      expect(hashProgramAuthoringPayload(covered)).not.toBe(
        hashProgramAuthoringPayload(original),
      );
      expect(covered.uploadTokenIds).toContain('cover-upload');
    });

    it('gives semantically equivalent normalized requests one canonical hash', () => {
      const implicit = buildProgramAuthoringPlan(request());
      const explicit = buildProgramAuthoringPlan({
        ...request(),
        name: 'Program',
        organizer: 'Organizer',
        description: 'Description',
        applicationStartAt: '2026-08-01T00:00:00.000Z',
        applicationEndAt: '2026-08-10T00:00:00.000Z',
        startAt: '2026-08-10T00:00:00.000Z',
        endAt: '2026-09-01T00:00:00.000Z',
        teamMinSize: 1,
        teamMaxSize: 1,
        repositoryProvisioningEnabled: false,

        notifyOnDeadline: true,
        milestones: request().milestones.map((milestone) => ({
          ...milestone,
          startAt: '2026-08-10T00:00:00.000Z',
          instructions: null,
          documents: milestone.documents.map((document) => ({
            ...document,
            name: document.name.trim(),
            templateUploadId: document.templateUploadId?.trim() ?? null,
          })),
        })),
      });

      const implicitHash = hashProgramAuthoringPayload(implicit);
      const explicitHash = hashProgramAuthoringPayload(explicit);

      expect(canonicalProgramAuthoringPayload(implicit).schemaVersion).toBe(2);
      expect(implicitHash).toMatch(/^[0-9a-f]{64}$/);
      expect(explicitHash).toBe(implicitHash);
    });

    it('preserves milestone order, document order, and token identity in the hash', () => {
      const original = request();
      const reversedMilestones: ProgramAuthoringRequest = {
        ...original,
        milestones: [...original.milestones].reverse(),
      };
      const firstMilestone = original.milestones[0];
      const reversedDocuments: ProgramAuthoringRequest = {
        ...original,
        milestones: firstMilestone
          ? [
              {
                ...firstMilestone,
                documents: [...firstMilestone.documents].reverse(),
              },
              ...original.milestones.slice(1),
            ]
          : original.milestones,
      };
      const changedToken: ProgramAuthoringRequest = {
        ...original,
        milestones: firstMilestone
          ? [
              {
                ...firstMilestone,
                documents: firstMilestone.documents.map((document, index) =>
                  index === 0
                    ? { ...document, templateUploadId: 'upload-4' }
                    : document,
                ),
              },
              ...original.milestones.slice(1),
            ]
          : original.milestones,
      };
      const originalHash = hashProgramAuthoringPayload(
        buildProgramAuthoringPlan(original),
      );

      expect(
        hashProgramAuthoringPayload(
          buildProgramAuthoringPlan(reversedMilestones),
        ),
      ).not.toBe(originalHash);
      expect(
        hashProgramAuthoringPayload(
          buildProgramAuthoringPlan(reversedDocuments),
        ),
      ).not.toBe(originalHash);
      expect(
        hashProgramAuthoringPayload(buildProgramAuthoringPlan(changedToken)),
      ).not.toBe(originalHash);
    });
  });
});

describe('program-authoring-upload-validation.policy', () => {
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
      ['photo.JPEG', 'IMAGE/JPEG', Buffer.from([0xff, 0xd8, 0xff])],
      ['photo.jpg', 'text/html', Buffer.from([0xff, 0xd8, 0xff])],
      ['photo.jpeg', '', Buffer.from([0xff, 0xd8, 0xff])],
      [
        'diagram.png',
        'image/png',
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ],
      [
        'diagram.png',
        'application/octet-stream',
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ],
    ])(
      'accepts a matching extension and signature regardless of browser MIME for %s',
      async (name, mimeType, signature) => {
        const upload = file({ name, mimeType, signature });

        const validated = await validateProgramAuthoringUpload(upload);

        expect(validated).toMatchObject({
          originalFileName: name,
          mimeType: mimeType.toLowerCase(),
          sizeBytes: upload.buffer.byteLength,
          sha256: createHash('sha256').update(upload.buffer).digest('hex'),
        });
      },
    );

    it.each([
      'application/zip',
      'application/x-zip-compressed',
      'application/octet-stream',
    ])(
      'accepts a real zip even when the browser labels it %s',
      async (mimetype) => {
        const archive = signatureValidZip([{ name: 'plan.pdf' }]);

        const validated = await validateProgramAuthoringUpload({
          buffer: archive,
          originalname: 'bundle.zip',
          mimetype,
          size: archive.byteLength,
        });

        expect(validated).toMatchObject({
          originalFileName: 'bundle.zip',
          mimeType: mimetype,
          sizeBytes: archive.byteLength,
          sha256: createHash('sha256').update(archive).digest('hex'),
        });
      },
    );

    it('rejects a zip whose metadata fails archive admission', async () => {
      const nested = signatureValidZip([{ name: 'nested.zip' }]);

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
      const upload = file({
        name: 'bundle.zip',
        mimeType: 'application/zip',
        signature: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      });

      await expect(
        validateProgramAuthoringUpload(upload),
      ).rejects.toMatchObject({
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
      const upload = file({
        name: 'maximum.pdf',
        mimeType: 'application/pdf',
        signature: Buffer.from('%PDF-'),
        actualSize: PROGRAM_AUTHORING_UPLOAD_MAX_BYTES,
      });

      const validated = await validateProgramAuthoringUpload(upload);

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
      await expect(validateProgramAuthoringUpload(upload)).rejects.toEqual(
        expect.objectContaining<Pick<ProgramAuthoringUploadError, 'code'>>({
          code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.INVALID_FILE,
        }),
      );
    });

    it('rejects one byte over 5 MiB even when the declared size matches', async () => {
      const upload = file({
        name: 'oversize.pdf',
        mimeType: 'application/pdf',
        signature: Buffer.from('%PDF-'),
        actualSize: PROGRAM_AUTHORING_UPLOAD_MAX_BYTES + 1,
      });

      await expect(validateProgramAuthoringUpload(upload)).rejects.toEqual(
        expect.objectContaining<Pick<ProgramAuthoringUploadError, 'code'>>({
          code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.FILE_TOO_LARGE,
        }),
      );
    });

    it.each([
      ['plan.exe', 'application/pdf', Buffer.from('%PDF-')],
      ['plan.pdf', 'application/pdf', Buffer.from('not-pdf')],
      ['photo.jpg', 'image/jpeg', Buffer.from('%PDF-')],
      ['.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff])],
      ['.jpeg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff])],
      [
        '.png',
        'image/png',
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ],
      ['diagram.png', 'image/png', Buffer.from([0x89, 0x50])],
      ['diagram.png', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff])],
    ])(
      'rejects an unsupported extension or signature',
      async (name, mimeType, signature) => {
        const upload = file({ name, mimeType, signature });

        await expect(validateProgramAuthoringUpload(upload)).rejects.toEqual(
          expect.objectContaining<Pick<ProgramAuthoringUploadError, 'code'>>({
            code: PROGRAM_AUTHORING_UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
          }),
        );
      },
    );
  });
});
