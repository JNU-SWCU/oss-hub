import { AccountStatus, MemberKind } from '@prisma/client';
import { PlatformModule } from '../platform/platform.module';
import { PublicProjectsService } from './public-projects.service';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../platform/auth.config';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import { PrismaService } from '../platform/prisma.service';
import { S3ObjectStorageClient } from '../platform/s3-object-storage.client';
import {
  ObjectStorageConfig,
  OBJECT_STORAGE,
} from '../platform/object-storage.config';
import { ProgramsModule } from './programs.module';

import {
  flowIds,
  flowGithubIds,
  seedMilestoneDocumentFlow,
} from './milestone-document-flow-data.integration-fixture';
import { AuthSessionService } from '../platform/auth-session.service';

const authSessionService = new AuthSessionService();

export { flowIds } from './milestone-document-flow-data.integration-fixture';

const sessionSecret = new Uint8Array(32).fill(37);
const origin = 'https://synthetic.example';

export class MilestoneDocumentFlowFixture {
  readonly prisma = new PrismaService();
  readonly storage = new S3ObjectStorageClient(new ObjectStorageConfig());
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
      imports: [PlatformModule, AuthModule, ProgramsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(this.prisma)
      .overrideProvider(AuthConfig)
      .useValue({ sessionSecret, allowedOrigin: origin })
      .overrideProvider(AuthService)
      .useValue(auth)
      .overrideProvider(PublicProjectsService)
      .useValue({})
      .overrideProvider(S3ObjectStorageClient)
      .useValue(this.storage)
      .overrideProvider(OBJECT_STORAGE)
      .useValue(this.storage)
      .compile();
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
    const token = await authSessionService.issueSessionToken(
      sessionSecret,
      flowGithubIds[input.actor ?? 'student'],
      0,
    );
    return fetch(`${await this.app.getUrl()}/api/v1/${path}`, {
      method: input.method ?? 'GET',
      headers: {
        origin,
        cookie: `${authSessionService.sessionCookieName(false)}=${token}`,
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
