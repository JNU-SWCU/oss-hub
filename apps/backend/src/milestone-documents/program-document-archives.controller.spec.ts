import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { Readable } from 'node:stream';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/service/auth.service';
import { sessionCookieName } from '../auth/domain/cookies';
import { issueSessionToken } from '../auth/domain/session-token';
import { SessionGuard } from '../auth/controller/session.guard';
import { ProblemDetailFilter } from '../common/controller/problem-detail.filter';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import { UsersAuthorityService } from '../users/service/authority.service';
import { DomainException } from '../common/error-code';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './domain/milestone-documents-error-code.enum';
import { type ProgramDocumentArchiveScope } from './milestone-document-archive.service';
import { ProgramDocumentArchivesController } from './program-document-archives.controller';

const secret = new Uint8Array(32).fill(39);
const githubId = 3429001135n;
const archiveForProgramStaff = jest.fn<
  ReturnType<MilestoneDocumentArchiveService['archiveForProgramStaff']>,
  Parameters<MilestoneDocumentArchiveService['archiveForProgramStaff']>
>();
const findUser = jest.fn();
let application: INestApplication;
let url: string;

beforeAll(async () => {
  const authority = new UsersAuthorityService({
    findActorByGithubId: findUser,
  });
  const module = await Test.createTestingModule({
    controllers: [ProgramDocumentArchivesController],
    providers: [
      SessionGuard,
      { provide: AuthConfig, useValue: { sessionSecret: secret } },
      {
        provide: AuthService,
        useValue: { getMe: jest.fn().mockResolvedValue({ sessionVersion: 0 }) },
      },
      {
        provide: MilestoneDocumentArchiveService,
        useValue: {
          archiveForProgramStaff: async (
            sessionGithubId: bigint,
            programId: string,
            scope: ProgramDocumentArchiveScope,
          ) => {
            await authority.assertActiveStaff(
              sessionGithubId,
              () =>
                new DomainException(
                  MILESTONE_DOCUMENTS_ERROR_CODES[
                    MilestoneDocumentsErrorCode.STAFF_ONLY
                  ],
                ),
            );
            return archiveForProgramStaff(sessionGithubId, programId, scope);
          },
        },
      },
    ],
  }).compile();
  application = module.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  url = `${await application.getUrl()}/api/v1/programs/synthetic-program/documents/collection/archive`;
});

beforeEach(() => {
  archiveForProgramStaff.mockReset().mockImplementation(() =>
    Promise.resolve({
      body: Readable.from(Buffer.from('synthetic-zip')),
      fileName: '예시 프로그램_현재제출.zip',
      contentType: 'application/zip',
      contentLength: 13,
    }),
  );
  findUser.mockReset().mockResolvedValue({
    id: 'synthetic-staff',
    hasStaffAccess: true,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  });
});
afterAll(async () => {
  await application.close();
});
async function headers() {
  return {
    cookie: `${sessionCookieName(false)}=${await issueSessionToken(secret, githubId, 0)}`,
  };
}

it.each([
  ['scope=PROGRAM', { kind: 'PROGRAM' }],
  ['scope=PROGRAM&groupBy=DOCUMENT', { kind: 'PROGRAM', grouping: 'DOCUMENT' }],
  [
    'scope=MILESTONE&milestoneId=stage-a',
    { kind: 'MILESTONE', milestoneId: 'stage-a' },
  ],
  ['scope=TEAM&teamId=team-a', { kind: 'TEAM', teamId: 'team-a' }],
])(
  'validates and streams %s with private attachment headers',
  async (query, scope) => {
    const response = await fetch(`${url}?${query}`, {
      headers: await headers(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-length')).toBe('13');
    expect(response.headers.get('content-disposition')).toContain(
      `filename*=UTF-8''${encodeURIComponent('예시 프로그램_현재제출.zip')}`,
    );
    expect(await response.text()).toBe('synthetic-zip');
    expect(archiveForProgramStaff).toHaveBeenCalledWith(
      githubId,
      'synthetic-program',
      scope,
    );
  },
);

it.each([
  '',
  'scope=ALL',
  'scope=PROGRAM&groupBy=INVALID',
  'scope=TEAM',
  'scope=MILESTONE',
  'scope=TEAM&teamId=',
  'scope=PROGRAM&teamId=team-a',
  'scope=PROGRAM&milestoneId=stage-a',
  'scope=TEAM&teamId=a&milestoneId=b',
  'scope=MILESTONE&milestoneId=a&teamId=b',
  'scope=TEAM&teamId=a&teamId=b',
  `scope=TEAM&teamId=${'x'.repeat(201)}`,
])(
  'rejects incomplete/conflicting scope before reading any submissions: %s',
  async (query) => {
    const response = await fetch(`${url}?${query}`, {
      headers: await headers(),
    });
    expect(response.status).toBe(400);
    expect(archiveForProgramStaff).not.toHaveBeenCalled();
  },
);

it('requires an authenticated session before querying an archive', async () => {
  const response = await fetch(`${url}?scope=PROGRAM`);
  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toMatchObject({
    status: 401,
    code: 'AUT_003',
  });
  expect(archiveForProgramStaff).not.toHaveBeenCalled();
});

it.each([
  {
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  },
  {
    hasStaffAccess: true,
    hasAdminAccess: false,
    accountStatus: AccountStatus.DEACTIVATED,
  },
])(
  'blocks non-staff/inactive users with service authorization (%o)',
  async (user) => {
    findUser.mockResolvedValue({ id: 'synthetic-user', ...user });
    const response = await fetch(`${url}?scope=PROGRAM`, {
      headers: await headers(),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      type: 'about:blank',
      title: 'FORBIDDEN',
      status: 403,
      detail: '승인된 교직원 또는 관리자만 사용할 수 있습니다.',
      instance:
        '/api/v1/programs/synthetic-program/documents/collection/archive',
      code: 'MSD_001',
    });
    expect(archiveForProgramStaff).not.toHaveBeenCalled();
  },
);

it('allows an active administrator without staff access', async () => {
  findUser.mockResolvedValue({
    id: 'synthetic-admin',
    hasStaffAccess: false,
    hasAdminAccess: true,
    accountStatus: AccountStatus.ACTIVE,
  });
  const response = await fetch(`${url}?scope=PROGRAM`, {
    headers: await headers(),
  });
  expect(response.status).toBe(200);
  await response.arrayBuffer();
});

it.each([AccountStatus.ACTIVE, AccountStatus.DEACTIVATED])(
  'rejects an invalid query before staff authorization (%s)',
  async (accountStatus) => {
    findUser.mockResolvedValue({
      id: 'synthetic-user',
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus,
    });
    const response = await fetch(`${url}?scope=INVALID`, {
      headers: await headers(),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      status: 400,
      code: 'SYS_003',
    });
    expect(findUser).not.toHaveBeenCalled();
    expect(archiveForProgramStaff).not.toHaveBeenCalled();
  },
);

it('returns a safe ProblemDetail instead of raw stream errors before ZIP headers are sent', async () => {
  const logger = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  archiveForProgramStaff.mockResolvedValue({
    body: new Readable({
      read() {
        this.destroy(new Error('synthetic-private-storage-error'));
      },
    }),
    fileName: 'broken.zip',
    contentType: 'application/zip',
    contentLength: 500,
  });
  try {
    const response = await fetch(`${url}?scope=PROGRAM`, {
      headers: await headers(),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(response.headers.get('content-type')).toContain(
      'application/problem+json',
    );
    const text = await response.text();
    expect(text).toContain('MSD_012');
    expect(text).not.toContain('synthetic-private-storage-error');
  } finally {
    logger.mockRestore();
  }
});

it.each([500, null])(
  'makes a truncated ZIP fail after headers (declared length %s)',
  async (contentLength) => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    let sent = false;
    const body = new Readable({
      read() {
        if (sent) return;
        sent = true;
        this.push(Buffer.from('partial'));
      },
    });
    archiveForProgramStaff.mockResolvedValue({
      body,
      fileName: 'partial.zip',
      contentType: 'application/zip',
      contentLength,
    });
    try {
      const response = await fetch(`${url}?scope=PROGRAM`, {
        headers: await headers(),
      });
      expect(response.status).toBe(200);
      const reading = expect(response.arrayBuffer()).rejects.toThrow();
      body.destroy(new Error('synthetic-disconnected-storage'));
      await reading;
      expect(logger).toHaveBeenCalledTimes(1);
    } finally {
      body.destroy();
      logger.mockRestore();
    }
  },
);
