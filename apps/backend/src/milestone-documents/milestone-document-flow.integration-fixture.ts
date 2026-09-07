import { AccountStatus, MemberKind } from '@prisma/client';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../auth/origin.guard';
import { sessionCookieName } from '../auth/cookies';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { S3SubmissionFileStorage } from '../submissions/s3-submission-file.storage';
import { SubmissionFileStorageConfig } from '../submissions/submission-file-storage.config';
import { SUBMISSION_FILE_STORAGE } from '../submissions/submission-file-storage.port';
import { SubmissionFilesRepository } from '../submissions/submission-files.repository';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import { MilestoneDocumentCurrentFileController } from './milestone-document-current-file.controller';
import { MilestoneDocumentCurrentFileRepository } from './milestone-document-current-file.repository';
import { MilestoneDocumentCurrentFileService } from './milestone-document-current-file.service';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import {
  MilestoneDocumentsController,
  MilestoneDocumentFilesController,
} from './milestone-documents.controller';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';
import { MilestoneDocumentsStaffGuard } from './milestone-documents-staff.guard';

import {
  flowIds,
  flowGithubIds,
  seedMilestoneDocumentFlow,
} from './milestone-document-flow.integration-data';
export {
  flowIds,
  flowGithubIds,
} from './milestone-document-flow.integration-data';

const sessionSecret = new Uint8Array(32).fill(37);
const origin = 'https://synthetic.example';

export class MilestoneDocumentFlowFixture {
  readonly prisma = new PrismaService();
  readonly storage = new S3SubmissionFileStorage(
    new SubmissionFileStorageConfig(),
  );
  private app: INestApplication | undefined;

  async start(): Promise<void> {
    await this.prisma.$connect();
    const auth: Pick<AuthService, 'getMe'> = {
      getMe: (githubId) =>
        Promise.resolve({
          id:
            githubId === flowGithubIds.staff ? flowIds.staff : flowIds.student,
          githubId,
          nickname: 'synthetic-flow-user',
          name: null,
          avatarUrl: null,
          accountStatus: AccountStatus.ACTIVE,
          sessionVersion: 0,
          memberKind: MemberKind.STUDENT,
          hasStaffAccess: githubId === flowGithubIds.staff,
          hasAdminAccess: false,
          isProfileComplete: true,
        }),
    };
    const module = await Test.createTestingModule({
      controllers: [
        MilestoneDocumentsController,
        MilestoneDocumentFilesController,
        MilestoneDocumentCurrentFileController,
      ],
      providers: [
        MilestoneDocumentsRepository,
        MilestoneDocumentsService,
        MilestoneDocumentReviewsService,
        MilestoneDocumentFilesService,
        MilestoneDocumentCurrentFileRepository,
        MilestoneDocumentCurrentFileService,
        SubmissionFilesRepository,
        SessionGuard,
        OriginGuard,
        MilestoneDocumentsStaffGuard,
        { provide: PrismaService, useValue: this.prisma },
        {
          provide: AuthConfig,
          useValue: { sessionSecret, allowedOrigin: origin },
        },
        { provide: AuthService, useValue: auth },
        { provide: SUBMISSION_FILE_STORAGE, useValue: this.storage },
        { provide: MilestoneDocumentArchiveService, useValue: {} },
      ],
    }).compile();
    this.app = module.createNestApplication();
    this.app.setGlobalPrefix('api/v1');
    this.app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    this.app.useGlobalFilters(new ProblemDetailFilter());
    await this.app.listen(0, '127.0.0.1');
  }

  async reset(): Promise<void> {
    await this.clear();
    await seedMilestoneDocumentFlow(this.prisma);
  }

  async request(
    path: string,
    input: {
      readonly actor?: 'student' | 'staff';
      readonly method?: string;
      readonly body?: BodyInit;
      readonly json?: unknown;
    } = {},
  ): Promise<Response> {
    if (this.app === undefined)
      throw new Error('Fixture application is not started');
    const token = await issueSessionToken(
      sessionSecret,
      flowGithubIds[input.actor ?? 'student'],
      0,
    );
    return fetch(`${await this.app.getUrl()}/api/v1/${path}`, {
      method: input.method ?? 'GET',
      headers: {
        origin,
        cookie: `${sessionCookieName(false)}=${token}`,
        ...(input.json === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      body: input.json === undefined ? input.body : JSON.stringify(input.json),
    });
  }

  submit(text: string, fileId?: string): Promise<Response> {
    return this.request(`${this.documentPath()}/submissions`, {
      method: 'POST',
      json: { content: { text, fileId } },
    });
  }

  documentPath(): string {
    return `milestones/${flowIds.milestone}/documents/${flowIds.document}`;
  }

  async closeDeadline(): Promise<void> {
    await this.prisma.milestone.update({
      where: { id: flowIds.milestone },
      data: { dueAt: new Date('2001-01-01') },
    });
  }

  async clear(): Promise<void> {
    const files = await this.prisma.submissionFile.findMany({
      where: { applicationId: flowIds.application },
      select: { storageKey: true },
    });
    await Promise.all(
      files.map((file) => this.storage.delete(file.storageKey)),
    );
    await this.prisma.submissionFile.deleteMany({
      where: { applicationId: flowIds.application },
    });
    const submissionWhere = {
      milestoneDocument: { milestoneId: flowIds.milestone },
    };
    await this.prisma.milestoneDocumentReviewHistory.deleteMany({
      where: { milestoneDocumentSubmission: submissionWhere },
    });
    await this.prisma.milestoneDocumentSubmissionHistory.deleteMany({
      where: { submission: submissionWhere },
    });
    await this.prisma.milestoneDocumentSubmission.deleteMany({
      where: submissionWhere,
    });
    await this.prisma.milestoneDocument.deleteMany({
      where: { milestoneId: flowIds.milestone },
    });
    await this.prisma.milestone.deleteMany({
      where: { id: flowIds.milestone },
    });
    await this.prisma.application.deleteMany({
      where: { id: flowIds.application },
    });
    await this.prisma.teamMember.deleteMany({
      where: { teamId: flowIds.team },
    });
    await this.prisma.team.deleteMany({ where: { id: flowIds.team } });
    await this.prisma.program.deleteMany({ where: { id: flowIds.program } });
    await this.prisma.user.deleteMany({
      where: { id: { in: [flowIds.student, flowIds.staff] } },
    });
  }

  async stop(): Promise<void> {
    await this.clear();
    await this.app?.close();
    await this.prisma.$disconnect();
  }
}
