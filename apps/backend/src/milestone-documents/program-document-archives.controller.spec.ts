import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { Readable } from 'node:stream';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import { MilestoneDocumentsStaffGuard } from './milestone-documents-staff.guard';
import { ProgramDocumentArchivesController } from './program-document-archives.controller';

const secret = new Uint8Array(32).fill(39);
const githubId = 3429001135n;
const archiveForProgramStaff = jest.fn();
const findUser = jest.fn();
let application: INestApplication;
let url: string;

beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [ProgramDocumentArchivesController],
    providers: [
      SessionGuard,
      MilestoneDocumentsStaffGuard,
      { provide: PrismaService, useValue: { user: { findUnique: findUser } } },
      { provide: AuthConfig, useValue: { sessionSecret: secret } },
      {
        provide: AuthService,
        useValue: { getMe: jest.fn().mockResolvedValue({ sessionVersion: 0 }) },
      },
      {
        provide: MilestoneDocumentArchiveService,
        useValue: { archiveForProgramStaff },
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
  'blocks non-staff/inactive users with the existing staff guard (%o)',
  async (user) => {
    findUser.mockResolvedValue({ id: 'synthetic-user', ...user });
    const response = await fetch(`${url}?scope=PROGRAM`, {
      headers: await headers(),
    });
    expect(response.status).toBe(403);
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
