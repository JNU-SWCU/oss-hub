import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/service/auth.service';
import { sessionCookieName } from '../auth/domain/cookies';
import { OriginGuard } from '../auth/controller/origin.guard';
import { issueSessionToken } from '../auth/domain/session-token';
import { SessionGuard } from '../auth/controller/session.guard';
import { ProblemDetailFilter } from '../common/controller/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { UsersAuthorityRepository } from '../users/repository/authority.repository';
import { UsersAuthorityService } from '../users/service/authority.service';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import { MilestoneDocumentCollectionService } from './milestone-document-collection.service';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsStaffGuard } from './milestone-documents-staff.guard';
import { MilestoneDocumentsController } from './milestone-documents.controller';
import { MilestoneDocumentsService } from './milestone-documents.service';
import { MilestoneDocumentsRepository } from './repository/milestone-documents.repository';

const secret = new Uint8Array(32).fill(47);
const origin = 'https://jnu-oss-hub.com';
const record = {
  id: 'document',
  milestoneId: 'milestone',
  name: '합성 서류',
  required: true,
  sortOrder: 1,
  templateFileId: null,
  templateFileName: null,
};
const documentBody = {
  id: 'document',
  milestoneId: 'milestone',
  name: '합성 서류',
  required: true,
  sortOrder: 1,
  hasTemplateFile: false,
  templateFileName: null,
};
const actors = [
  ['anonymous', null, false, false, AccountStatus.ACTIVE, 401],
  ['student', 1n, false, false, AccountStatus.ACTIVE, 403],
  ['inactive staff', 2n, true, false, AccountStatus.DEACTIVATED, 403],
  ['staff', 3n, true, false, AccountStatus.ACTIVE, 200],
  ['admin', 4n, false, true, AccountStatus.ACTIVE, 200],
] as const;
const routes = [
  [
    'POST',
    '',
    { name: '합성 서류', required: true, sortOrder: 1 },
    201,
    documentBody,
  ],
  [
    'PATCH',
    '/document',
    { name: '합성 서류', required: true, sortOrder: 1 },
    200,
    documentBody,
  ],
  [
    'PATCH',
    '/order',
    { documentIds: ['document', 'other'] },
    200,
    [documentBody],
  ],
  ['DELETE', '/document', undefined, 204, null],
] as const;
const writer = jest.fn();
let app: INestApplication;
let base: string;

beforeAll(async () => {
  const findActor = (githubId: bigint) => {
    const actor = actors.find((item) => item[1] === githubId);
    return Promise.resolve(
      actor === undefined
        ? null
        : {
            id: `actor-${githubId}`,
            hasStaffAccess: actor[2],
            hasAdminAccess: actor[3],
            accountStatus: actor[4],
          },
    );
  };
  const store = {
    lockMilestone: jest.fn().mockResolvedValue({ id: 'milestone' }),
    lockDocument: jest.fn().mockResolvedValue(record),
    lockDocumentIdsOfMilestone: jest
      .fn()
      .mockResolvedValue(['document', 'other']),
    createDocument: jest.fn().mockResolvedValue(record),
    updateDocument: jest.fn().mockResolvedValue(record),
    applyDocumentOrder: jest.fn().mockResolvedValue([record]),
    countSubmissionsForDocument: jest.fn().mockResolvedValue(0),
    deleteDocument: jest.fn().mockResolvedValue(undefined),
  };
  writer.mockImplementation(
    (operation: (value: typeof store) => Promise<unknown>) => operation(store),
  );
  const module = await Test.createTestingModule({
    controllers: [MilestoneDocumentsController],
    providers: [
      SessionGuard,
      OriginGuard,
      MilestoneDocumentsStaffGuard,
      MilestoneDocumentsService,
      UsersAuthorityService,
      {
        provide: AuthConfig,
        useValue: { sessionSecret: secret, allowedOrigin: origin },
      },
      {
        provide: AuthService,
        useValue: { getMe: jest.fn().mockResolvedValue({ sessionVersion: 0 }) },
      },
      {
        provide: PrismaService,
        useValue: {
          user: {
            findUnique: (input: { where: { githubId: bigint } }) =>
              findActor(input.where.githubId),
          },
        },
      },
      {
        provide: UsersAuthorityRepository,
        useValue: { findActorByGithubId: findActor },
      },
      {
        provide: MilestoneDocumentsRepository,
        useValue: { withTransaction: writer },
      },
      { provide: MilestoneDocumentArchiveService, useValue: {} },
      { provide: MilestoneDocumentCollectionService, useValue: {} },
      { provide: MilestoneDocumentFilesService, useValue: {} },
      { provide: MilestoneDocumentReviewsService, useValue: {} },
    ],
  }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ProblemDetailFilter());
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api/v1/milestones/milestone/documents`;
});

afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  writer.mockClear();
});

it.each(actors)(
  'preserves the complete valid-request contract for %s',
  async (_role, githubId, _staff, _admin, _active, expectedStatus) => {
    for (const [method, path, body, successStatus, successBody] of routes) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          origin,
          'content-type': 'application/json',
          ...(githubId === null
            ? {}
            : {
                cookie: `${sessionCookieName(false)}=${await issueSessionToken(secret, githubId, 0)}`,
              }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      expect(response.status).toBe(
        expectedStatus === 200 ? successStatus : expectedStatus,
      );
      if (expectedStatus === 200) {
        if (successStatus === 204) expect(await response.text()).toBe('');
        else await expect(response.json()).resolves.toEqual(successBody);
      } else {
        await expect(response.json()).resolves.toEqual({
          type: 'about:blank',
          title: expectedStatus === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
          status: expectedStatus,
          detail:
            expectedStatus === 401
              ? '로그인이 필요합니다.'
              : '승인된 교직원 또는 관리자만 사용할 수 있습니다.',
          instance: `/api/v1/milestones/milestone/documents${path}`,
          code: expectedStatus === 401 ? 'AUT_003' : 'MSD_001',
        });
      }
    }
    expect(writer).toHaveBeenCalledTimes(expectedStatus === 200 ? 4 : 0);
  },
);
