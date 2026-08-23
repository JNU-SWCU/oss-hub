import { MemberKind } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentsController } from './milestone-documents.controller';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';

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
  await prisma.milestoneDocumentTemplateFile.deleteMany({
    where: { milestoneDocument: { milestoneId } },
  });
  await prisma.milestoneDocument.deleteMany({ where: { milestoneId } });
  await prisma.milestone.deleteMany({ where: { id: milestoneId } });
  await prisma.program.deleteMany({ where: { id: programId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

async function requestList(): Promise<Response> {
  const token = await issueSessionToken(sessionSecret, githubId);
  const url = `${await application.getUrl()}/api/v1/milestones/${milestoneId}/documents`;
  return fetch(url, {
    headers: { cookie: `${sessionCookieName(false)}=${token}` },
  });
}

describe('authenticated milestone document list filename contract', () => {
  beforeAll(async () => {
    await prisma.$connect();
    const module = await Test.createTestingModule({
      controllers: [MilestoneDocumentsController],
      providers: [
        MilestoneDocumentsRepository,
        MilestoneDocumentsService,
        SessionGuard,
        { provide: MilestoneDocumentFilesService, useValue: {} },
        { provide: MilestoneDocumentReviewsService, useValue: {} },
        { provide: MilestoneDocumentArchiveService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: AuthConfig, useValue: { sessionSecret } },
        { provide: AuthService, useValue: { getMe: jest.fn() } },
      ],
    }).compile();
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
        selectedMemberKind: MemberKind.STUDENT,
      },
    });
    await prisma.program.create({
      data: {
        id: programId,
        name: 'synthetic milestone list program',
        organizer: 'OSS Hub',
        category: 'CAPSTONE',
        applicationTemplateKey: 'capstone-v1',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2025-12-01'),
        applicationEndAt: new Date('2026-01-01'),
        startAt: new Date('2026-01-02'),
        endAt: new Date('2026-12-31'),
        description: 'synthetic integration fixture',
        milestones: {
          create: {
            id: milestoneId,
            name: 'synthetic milestone',
            dueAt: new Date('2026-11-01'),
            submissionType: 'FILE',
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
    await prisma.milestoneDocument.createMany({
      data: [
        {
          id: `${prefix}-with-file`,
          milestoneId,
          name: '운영 결과',
          required: true,
          sortOrder: 1,
          submissionType: 'FILE',
        },
        {
          id: `${prefix}-without-file`,
          milestoneId,
          name: '첨부 없음',
          required: false,
          sortOrder: 2,
          submissionType: 'FILE',
        },
      ],
    });
    await prisma.milestoneDocumentTemplateFile.create({
      data: {
        milestoneDocumentId: `${prefix}-with-file`,
        uploadedById: userId,
        storageKey: `${prefix}/private/object-key`,
        originalFileName: '운영결과보고서_2026.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 123,
        uploadedAt: new Date('2026-08-20'),
      },
    });

    const response = await requestList();
    const body = (await response.json()) as readonly Record<string, unknown>[];
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toEqual(
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
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('private/object-key');
    expect(serialized).not.toMatch(/https?:\/\//);
  });
});
