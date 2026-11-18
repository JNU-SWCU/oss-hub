import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
  databaseSessionPrincipal,
} from '../../test/global-authentication-guard.fixture';
import { STATELESS_PROVIDERS } from '../../test/stateless-providers.fixture';
import { AuthService } from '../auth/auth.service';
import { AuthConfig } from '../platform/auth.config';
import { AuthSessionService } from '../platform/auth-session.service';
import { OriginGuard } from '../platform/origin.guard';
import type { ActiveAccountPrincipal } from '../auth/http-auth.types';
import type { MailSender } from './gmail-mail.client';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import type { PrismaService } from '../platform/prisma.service';
import {
  createDeadlineDigestIntegrationHarness,
  DIGEST_FIXTURE,
  RecordingMailSender,
} from './deadline-digest.integration-support';
import { ProgramMailAuditRepository } from './program-mail-audit.repository';
import { ProgramMailController } from './program-mail.controller';
import { ProgramMailDeliveryRepository } from './program-mail-delivery.repository';
import { ProgramMailDeliveryService } from './program-mail-delivery.service';
import {
  ProgramMailRepository,
  type ProgramMailAudience,
} from './program-mail.repository';
import { ProgramMailSendRepository } from './program-mail-send.repository';
import { ProgramMailService } from './program-mail.service';
import { ProgramMailTemplateService } from './program-mail-template.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

type ConfirmedProgramMail = {
  readonly subject: string;
  readonly body: string;
  readonly applicantIds: readonly string[];
  readonly previewedAt: string;
  readonly previewVersion: string;
};

export type ProgramMailIntegrationWorld = {
  readonly prisma: PrismaService;
  readonly mailSender: RecordingMailSender;
  createService(mailSender: MailSender): ProgramMailService;
  principal(githubId: bigint): Promise<ActiveAccountPrincipal>;
  endpoint(action: 'recipients' | 'preview' | 'send'): string;
  sessionCookie(githubId: bigint): Promise<string>;
  cookieForUser(userId: string): Promise<string>;
  post(
    action: 'preview' | 'send',
    body: object,
    cookie: string | null,
  ): Promise<Response>;
  confirmedPreview(cookie: string): Promise<ConfirmedProgramMail>;
  findAudience(window: {
    readonly from: Date;
    readonly to: Date;
  }): Promise<ProgramMailAudience | null>;
  legacyRecipientIds(window: {
    readonly from: Date;
    readonly to: Date;
  }): Promise<readonly string[]>;
  reset(): Promise<void>;
  close(): Promise<void>;
};

export async function startProgramMailIntegration(): Promise<ProgramMailIntegrationWorld> {
  const harness = createDeadlineDigestIntegrationHarness();
  const mailSender = new RecordingMailSender();
  const repository = new ProgramMailRepository(harness.prisma);
  const createService = (sender: MailSender) =>
    new ProgramMailService(
      new ProgramMailRepository(harness.prisma),
      new ProgramMailDeliveryService(
        new ProgramMailSendRepository(
          harness.prisma,
          new ProgramMailAuditRepository(),
          new ProgramMailDeliveryRepository(harness.prisma),
        ),
        sender,
        new ProgramMailTemplateService(),
      ),
    );
  const service = createService(mailSender);
  const sessions = new AuthSessionService();
  const sessionSecret = new Uint8Array(32).fill(8);
  await harness.connect();
  await harness.reset();
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramMailController],
    providers: [
      ...STATELESS_PROVIDERS,
      AuthSessionService,
      ...GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
      OriginGuard,
      { provide: ProgramMailService, useValue: service },
      {
        provide: AuthService,
        useValue: {
          getMe: (githubId: bigint) =>
            databaseSessionPrincipal(harness.prisma, githubId),
        },
      },
      {
        provide: AuthConfig,
        useValue: {
          sessionSecret,
          allowedOrigin: 'http://frontend.test',
          useSecureCookies: false,
        },
      },
    ],
  })
    .overrideGuard(OriginGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app: INestApplication = moduleRef.createNestApplication();
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
  const baseUrl = await app.getUrl();
  const endpoint = (action: 'recipients' | 'preview' | 'send') =>
    `${baseUrl}/api/v1/programs/${DIGEST_FIXTURE.notifyProgram}/mail/${action}`;
  const sessionCookie = async (githubId: bigint) => {
    const token = await sessions.issueSessionToken(sessionSecret, githubId, 0);
    return `${sessions.sessionCookieName(false)}=${token}`;
  };
  const post = (
    action: 'preview' | 'send',
    body: object,
    cookie: string | null,
  ) =>
    fetch(endpoint(action), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
      },
      body: JSON.stringify(body),
    });
  return {
    prisma: harness.prisma,
    mailSender,
    createService,
    principal: (githubId) => databaseSessionPrincipal(harness.prisma, githubId),
    endpoint,
    sessionCookie,
    cookieForUser: async (userId) => {
      const user = await harness.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { githubId: true },
      });
      return sessionCookie(user.githubId);
    },
    post,
    confirmedPreview: async (cookie) => {
      const draft = {
        subject: '프로그램 안내',
        body: '선택 학생에게 보내는 합성 본문',
        applicantIds: [DIGEST_FIXTURE.studentMissing],
      };
      const response = await post('preview', draft, cookie);
      const value: unknown = await response.json();
      if (
        typeof value !== 'object' ||
        value === null ||
        !('previewedAt' in value) ||
        !('previewVersion' in value) ||
        typeof value.previewedAt !== 'string' ||
        typeof value.previewVersion !== 'string'
      ) {
        throw new TypeError('Invalid program mail preview');
      }
      return {
        ...draft,
        previewedAt: value.previewedAt,
        previewVersion: value.previewVersion,
      };
    },
    findAudience: (window) =>
      repository.findAudience(DIGEST_FIXTURE.notifyProgram, window),
    legacyRecipientIds: async (window) => {
      const source = await harness.repository.findDeadlineProgram(
        DIGEST_FIXTURE.notifyProgram,
      );
      if (source === null) throw new TypeError('Missing deadline fixture');
      return harness
        .service(mailSender)
        .buildDeadlineEligibility(source, window)
        .recipients.map((recipient) => recipient.id);
    },
    reset: async () => {
      mailSender.sent.length = 0;
      await harness.prisma.notification.deleteMany({
        where: { type: { in: ['PROGRAM_MAIL', 'PROGRAM_MAIL_SEND'] } },
      });
      await harness.prisma.team.updateMany({
        where: {
          id: {
            in: [
              DIGEST_FIXTURE.missingApplication,
              DIGEST_FIXTURE.submittedApplication,
              DIGEST_FIXTURE.offApplication,
              DIGEST_FIXTURE.deactivatedApplication,
            ],
          },
        },
        data: { status: 'APPROVED', archivedAt: null },
      });
    },
    close: async () => {
      await app.close();
      await harness.prisma.$disconnect();
    },
  };
}
