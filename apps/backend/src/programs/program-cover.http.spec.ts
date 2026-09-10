import { Readable } from 'node:stream';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SessionGuard } from '../auth/session.guard';
import { OriginGuard } from '../auth/origin.guard';
import {
  SUBMISSION_FILE_STORAGE,
  SubmissionFileStorageError,
} from '../submissions/submission-file-storage.port';
import { ProgramAuthoringController } from './controller/program-authoring.controller';
import { ProgramCoverController } from './controller/program-cover.controller';
import { ProgramAuthoringRepository } from './program-authoring.repository';
import { ProgramAuthoringService } from './program-authoring.service';
import {
  ProgramAuthoringUploadRepository,
  type CreatePendingProgramAuthoringUploadInput,
} from './program-authoring-upload.repository';
import { ProgramAuthoringUploadService } from './program-authoring-upload.service';
import { ProgramCoverRepository } from './repository/program-cover.repository';
import { ProgramCoverService } from './service/program-cover.service';
import { PROGRAM_COVER_MAX_BYTES } from './program-cover';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXuoAAAAASUVORK5CYII=',
  'base64',
);
let application: INestApplication;
let baseUrl = '';
let authenticated = true;
let originAllowed = true;
let staff = true;
let admin = false;
const pending = jest.fn((input: CreatePendingProgramAuthoringUploadInput) =>
  Promise.resolve({ ...input, id: 'pending-cover' }),
);
const get = jest.fn(() => Promise.resolve(Readable.from(PNG)));
const put = jest.fn(() => Promise.resolve({}));

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramAuthoringController, ProgramCoverController],
    providers: [
      ProgramAuthoringUploadService,
      ProgramCoverService,
      { provide: ProgramAuthoringService, useValue: {} },
      {
        provide: ProgramAuthoringRepository,
        useValue: {
          findActor: () =>
            Promise.resolve({
              id: 'staff',
              accountStatus: 'ACTIVE',
              hasStaffAccess: staff,
              hasAdminAccess: admin,
            }),
        },
      },
      {
        provide: ProgramAuthoringUploadRepository,
        useValue: { createPending: pending },
      },
      { provide: SUBMISSION_FILE_STORAGE, useValue: { get, put } },
      {
        provide: ProgramCoverRepository,
        useValue: {
          findPublicCover: (programId: string, coverId: string) =>
            Promise.resolve(
              programId === 'program' && coverId === 'current'
                ? {
                    storageKey: 'program-covers/current',
                    mimeType: 'image/png',
                    sizeBytes: PNG.length,
                  }
                : null,
            ),
        },
      },
    ],
  })
    .overrideGuard(SessionGuard)
    .useValue({
      canActivate(context: ExecutionContext) {
        context
          .switchToHttp()
          .getRequest<{ sessionGithubId: bigint }>().sessionGithubId = 1266n;
        return authenticated;
      },
    })
    .overrideGuard(OriginGuard)
    .useValue({ canActivate: () => originAllowed })
    .compile();
  application = moduleRef.createNestApplication();
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
});

beforeEach(() => {
  authenticated = true;
  originAllowed = true;
  staff = true;
  admin = false;
  jest.clearAllMocks();
});
afterAll(() => application.close());

function body(bytes = PNG, name = 'cover.png', type = 'image/png') {
  const form = new FormData();
  form.append('file', new Blob([Uint8Array.from(bytes)], { type }), name);
  return form;
}

it('serves only the current attached image anonymously with explicit safe headers', async () => {
  authenticated = false;
  const response = await fetch(`${baseUrl}/programs/program/cover/current`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
  expect(get).toHaveBeenCalledWith('program-covers/current');
});

it.each([
  'program/cover/pending-cover',
  'program/cover/replaced',
  'missing/cover/current',
])('does not read storage for %s', async (path) => {
  const response = await fetch(`${baseUrl}/programs/${path}`);
  expect(response.status).toBe(404);
  expect(get).not.toHaveBeenCalled();
});

it.each([
  ['SUBMISSION_FILE_STORAGE_GET_NOT_FOUND', 404],
  ['SUBMISSION_FILE_STORAGE_GET_FAILED', 503],
] as const)(
  'conceals storage failures behind the %s response',
  async (code, status) => {
    get.mockRejectedValueOnce(new SubmissionFileStorageError(code));
    const response = await fetch(`${baseUrl}/programs/program/cover/current`);
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain('program-covers/');
  },
);

it.each(['staff', 'admin'])(
  'stages a private image for an authorized %s without changing the program',
  async (role) => {
    staff = role === 'staff';
    admin = role === 'admin';
    const response = await fetch(`${baseUrl}/program-authoring/cover-uploads`, {
      method: 'POST',
      body: body(),
    });
    expect(response.status).toBe(201);
    const expiresAt: unknown = expect.any(String);
    expect(await response.json()).toEqual({
      id: 'pending-cover',
      fileName: 'cover.png',
      contentType: 'image/png',
      size: PNG.length,
      expiresAt,
    });
    expect(pending.mock.calls[0]?.[0].storageKey).toMatch(/^program-covers\//);
    expect(put).toHaveBeenCalledTimes(1);
  },
);

it.each(['anonymous', 'student', 'origin'])(
  'rejects %s upload before storing bytes',
  async (reason) => {
    authenticated = reason !== 'anonymous';
    staff = reason !== 'student';
    originAllowed = reason !== 'origin';
    const response = await fetch(`${baseUrl}/program-authoring/cover-uploads`, {
      method: 'POST',
      body: body(),
    });
    expect(response.status).toBe(reason === 'student' ? 409 : 403);
    expect(pending).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  },
);

it('enforces the multipart size limit before persistence', async () => {
  const response = await fetch(`${baseUrl}/program-authoring/cover-uploads`, {
    method: 'POST',
    body: body(Buffer.alloc(PROGRAM_COVER_MAX_BYTES + 1)),
  });
  expect(response.status).toBe(413);
  expect(pending).not.toHaveBeenCalled();
});

it('rejects forged images and multiple files', async () => {
  const forged = await fetch(`${baseUrl}/program-authoring/cover-uploads`, {
    method: 'POST',
    body: body(Buffer.from('<svg/>')),
  });
  expect(forged.status).toBe(400);
  const multiple = body();
  multiple.append(
    'file',
    new Blob([Uint8Array.from(PNG)], { type: 'image/png' }),
    'second.png',
  );
  const response = await fetch(`${baseUrl}/program-authoring/cover-uploads`, {
    method: 'POST',
    body: multiple,
  });
  expect(response.status).toBe(400);
  expect(pending).not.toHaveBeenCalled();
});
