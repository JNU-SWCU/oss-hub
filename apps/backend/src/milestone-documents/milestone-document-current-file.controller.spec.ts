import type { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { Readable } from 'node:stream';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { MilestoneDocumentCurrentFileController } from './milestone-document-current-file.controller';
import { MilestoneDocumentCurrentFileService } from './milestone-document-current-file.service';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';

const SESSION_GITHUB_ID = 342_900_002n;
const SESSION_SECRET = new Uint8Array(32).fill(37);
const download = jest.fn();
let application: INestApplication | undefined;
let baseUrl = '';

beforeEach(() => {
  download.mockReset().mockResolvedValue({
    body: Readable.from(Buffer.from('student-current-bytes')),
    fileName: '현재 계획서.pdf',
    contentType: 'application/pdf',
    contentLength: 21,
  });
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [MilestoneDocumentCurrentFileController],
    providers: [
      SessionGuard,
      {
        provide: AuthConfig,
        useValue: {
          sessionSecret: SESSION_SECRET,
          allowedOrigin: 'http://frontend.test',
          useSecureCookies: false,
        },
      },
      {
        provide: AuthService,
        useValue: {
          getMe: jest
            .fn()
            .mockResolvedValue({ id: 'viewer', sessionVersion: 0 }),
        },
      },
      {
        provide: MilestoneDocumentCurrentFileService,
        useValue: { download },
      },
    ],
  }).compile();

  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
});

afterAll(async () => {
  await application?.close();
});

function currentFileUrl(documentId: string): string {
  return `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/${documentId}/submissions/current/file`;
}

async function authenticatedHeaders(): Promise<{ readonly cookie: string }> {
  const token = await issueSessionToken(SESSION_SECRET, SESSION_GITHUB_ID, 0);
  return { cookie: `${sessionCookieName(false)}=${token}` };
}

it('같은 current bytes와 안전한 attachment 헤더 및 no-store를 반환한다', async () => {
  // When
  const response = await fetch(currentFileUrl('synthetic-document'), {
    headers: await authenticatedHeaders(),
  });

  // Then
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-type')).toBe('application/pdf');
  expect(response.headers.get('content-length')).toBe('21');
  const disposition = response.headers.get('content-disposition') ?? '';
  expect(disposition).toContain('attachment');
  expect(disposition).toContain(
    `filename*=UTF-8''${encodeURIComponent('현재 계획서.pdf')}`,
  );
  await expect(response.text()).resolves.toBe('student-current-bytes');
  expect(download).toHaveBeenCalledWith(
    SESSION_GITHUB_ID,
    'synthetic-milestone',
    'synthetic-document',
  );
});

it.each(['cross-team', 'nonexistent'])(
  '%s 현재 파일을 같은 404 ProblemDetail로 감춘다',
  async (documentId) => {
    // Given
    download.mockRejectedValueOnce(
      new DomainException(
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND
        ],
      ),
    );

    // When
    const response = await fetch(currentFileUrl(documentId), {
      headers: await authenticatedHeaders(),
    });

    // Then
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      status: 404,
      code: MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND,
      detail: '제출된 파일을 찾을 수 없습니다.',
    });
  },
);

it('미인증 요청은 current-file 조회 전에 AUT_003 401로 거부한다', async () => {
  // When
  const response = await fetch(currentFileUrl('synthetic-document'));

  // Then
  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(response.json()).resolves.toMatchObject({
    status: 401,
    code: 'AUT_003',
  });
  expect(download).not.toHaveBeenCalled();
});

it('SessionGuard만 붙여 미인증 요청을 401 경계에 둔다', () => {
  // Given / When
  const handler: unknown = Object.getOwnPropertyDescriptor(
    MilestoneDocumentCurrentFileController.prototype,
    'downloadCurrentSubmissionFile',
  )?.value;

  // Then
  expect(typeof handler).toBe('function');
  if (typeof handler !== 'function') return;
  expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([SessionGuard]);
});
