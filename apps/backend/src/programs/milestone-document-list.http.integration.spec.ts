import { STATELESS_PROVIDERS } from '../../test/stateless-providers.fixture';
import { DownloadResponseService } from './download-response.service';
import { AccountStatus, ProgramCategory } from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuthConfig } from '../platform/auth.config';
import { AuthService } from '../auth/auth.service';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import { PrismaService } from '../platform/prisma.service';
import {
  RequirementArchiveService,
  MilestoneDocumentCollectionService,
} from './requirement-archive.service';
import {
  MilestoneDocumentFilesService,
  SubmissionFileAdmissionService,
  MilestoneDocumentFileNameService,
  MilestoneDocumentSubmissionWindowService,
} from './files.service';
import { RequirementsController } from './requirements.controller';
import { MilestoneDocumentReviewsService } from './submissions.service';
import { RequirementsRepository } from './requirements.repository';
import { RequirementsService } from './requirements.service';
import { AuthSessionService } from '../platform/auth-session.service';
import { ProgramScheduleService } from './program-schedule.service';
import { GLOBAL_AUTHENTICATION_GUARD_PROVIDERS } from '../../test/global-authentication-guard.fixture';

const authSessionService = new AuthSessionService();
type ActivePrincipal = Awaited<ReturnType<AuthService['getMe']>>;
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prefix = 'milestone-list-http-contract';
const githubId = 9600000000999001n;
const programId = `${prefix}-program`;
const milestoneId = `${prefix}-milestone`;
const userId = `${prefix}-user`;
const sessionSecret = new Uint8Array(32).fill(23);
const prisma = new PrismaService();
let application: INestApplication;
async function cleanup(): Promise<void> {
  await prisma.file.deleteMany({
    where: { kind: 'TEMPLATE', requirement: { milestoneId } },
  });
  await prisma.requirement.deleteMany({ where: { milestoneId } });
  await prisma.milestone.deleteMany({ where: { id: milestoneId } });
  await prisma.program.deleteMany({ where: { id: programId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}
async function requestList(): Promise<Response> {
  const token = await authSessionService.issueSessionToken(
    sessionSecret,
    githubId,
    0,
  );
  const url = `${await application.getUrl()}/api/v1/milestones/${milestoneId}/documents`;
  return fetch(url, {
    headers: {
      cookie: `${authSessionService.sessionCookieName(false)}=${token}`,
    },
  });
}
describe('authenticated milestone document list filename contract', () => {
  beforeAll(async () => {
    await prisma.$connect();
    const module = await Test.createTestingModule({
      controllers: [RequirementsController],
      providers: [
        ...STATELESS_PROVIDERS,
        { provide: MilestoneDocumentCollectionService, useValue: {} },
        RequirementsRepository,
        RequirementsService,
        MilestoneDocumentFileNameService,
        MilestoneDocumentSubmissionWindowService,
        ProgramScheduleService,
        SubmissionFileAdmissionService,
        AuthSessionService,
        ...GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
        {
          provide: MilestoneDocumentFilesService,
          useValue: Object.assign(
            Object.create(MilestoneDocumentFilesService.prototype) as object,
            { downloadResponseService: new DownloadResponseService() },
          ),
        },
        { provide: MilestoneDocumentReviewsService, useValue: {} },
        {
          provide: RequirementArchiveService,
          useValue: Object.assign(
            Object.create(RequirementArchiveService.prototype) as object,
            { downloadResponseService: new DownloadResponseService() },
          ),
        },
        { provide: PrismaService, useValue: prisma },
        { provide: AuthConfig, useValue: { sessionSecret } },
        {
          provide: AuthService,
          useValue: {
            getMe: jest
              .fn<Promise<ActivePrincipal>, [bigint]>()
              .mockImplementation((principalGithubId) =>
                Promise.resolve({
                  id: userId,
                  githubId: principalGithubId,
                  nickname: `${prefix}-login`,
                  name: null,
                  avatarUrl: null,
                  accountStatus: AccountStatus.ACTIVE,
                  sessionVersion: 0,
                  memberKind: null,
                  hasStaffAccess: false,
                  hasAdminAccess: false,
                  isProfileComplete: false,
                }),
              ),
          },
        },
      ],
    })
      .useMocker((token) => (token === Function ? undefined : {}))
      .compile();
    application = module.createNestApplication();
    application.setGlobalPrefix('api/v1');
    application.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    application.useGlobalFilters(new ProblemDetailFilter());
    await application.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    await cleanup();
    await prisma.user.create({
      data: {
        id: userId,
        githubId,
        nickname: 'synthetic-list-user',
        type: MemberKind.STUDENT,
        approvalStatus: 'NOT_REQUIRED',
      },
    });
    await prisma.program.create({
      data: {
        id: programId,
        name: 'synthetic milestone list program',
        organizer: 'OSS Hub',
        trackType: 'CURRICULAR',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'capstone-v1',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2025-12-01'),
        applicationEndAt: new Date('2026-01-01'),
        startAt: new Date('2026-01-02'),
        endAt: new Date('2026-12-31'),
        description: 'synthetic integration fixture',
        milestones: {
          create: {
            startAt: new Date('2026-01-02'),
            id: milestoneId,
            name: 'synthetic milestone',
            dueAt: new Date('2026-11-01'),
          },
        },
      },
    });
  });
  afterAll(async () => {
    await cleanup();
    await application.close();
    await prisma.$disconnect();
  });
  it('returns filename states without storage metadata over authenticated HTTP', async () => {
    await prisma.requirement.createMany({
      data: [
        {
          id: `${prefix}-with-file`,
          milestoneId,
          name: '운영 결과',
          required: true,
          sortOrder: 1,
        },
        {
          id: `${prefix}-without-file`,
          milestoneId,
          name: '첨부 없음',
          required: false,
          sortOrder: 2,
        },
      ],
    });
    await prisma.file.create({
      data: {
        kind: 'TEMPLATE',
        lifecycle: 'ATTACHED',
        requirementId: `${prefix}-with-file`,
        uploaderId: userId,
        storageKey: `${prefix}/private/object-key`,
        originalFileName: '운영결과보고서_2026.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 123,
        createdAt: new Date('2026-08-20'),
      },
    });
    const response = await requestList();
    const body = (await response.json()) as {
      readonly documents: readonly Record<string, unknown>[];
      readonly fileUpload: Record<string, unknown>;
    };
    const serialized = JSON.stringify(body);
    expect(response.status).toBe(200);
    expect(body.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          templateFileName: '운영결과보고서_2026.docx',
          hasTemplateFile: true,
        }),
        expect.objectContaining({
          templateFileName: null,
          hasTemplateFile: false,
        }),
      ]),
    );
    expect(body.fileUpload).toEqual({
      maxBytes: 5 * 1024 * 1024,
      maxLabel: '5 MB',
      accept: '.pdf,.hwp,.zip',
      formatLabel: 'PDF, HWP, ZIP',
    });
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('private/object-key');
    expect(serialized).not.toMatch(/https?:\/\//);
  });
});
