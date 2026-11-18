import {
  ValidationPipe,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  databaseSessionPrincipal,
  protectedRouteGuardStub,
} from '../../test/global-authentication-guard.fixture';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { OriginGuard } from '../platform/origin.guard';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import {
  createDeadlineDigestIntegrationHarness,
  DIGEST_FIXTURE,
  RecordingMailSender,
} from './deadline-digest.integration-support';
import { ProgramMailController } from './program-mail.controller';
import { ProgramMailDeliveryService } from './program-mail-delivery.service';
import { ProgramMailRepository } from './program-mail.repository';
import { ProgramMailService } from './program-mail.service';
import { ProgramMailTemplateService } from './program-mail-template.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const harness = createDeadlineDigestIntegrationHarness();
const sender = new RecordingMailSender();
const repository = new ProgramMailRepository(harness.prisma);
const service = new ProgramMailService(
  repository,
  new ProgramMailDeliveryService(
    repository,
    sender,
    new ProgramMailTemplateService(),
  ),
);
let app: INestApplication;
let baseUrl = '';

beforeAll(async () => {
  await harness.connect();
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramMailController],
    providers: [
      protectedRouteGuardStub({
        async canActivate(context: ExecutionContext) {
          const request = context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>();
          request.sessionGithubId = DIGEST_FIXTURE.staffOnGithub;
          Object.assign(request, {
            principal: await databaseSessionPrincipal(
              harness.prisma,
              DIGEST_FIXTURE.staffOnGithub,
            ),
          });
          return true;
        },
      }),
      { provide: ProgramMailService, useValue: service },
    ],
  })
    .overrideGuard(OriginGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = moduleRef.createNestApplication();
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
  baseUrl = await app.getUrl();
});

beforeEach(async () => {
  await harness.reset();
  sender.sent.length = 0;
});

afterAll(async () => {
  await app.close();
  await harness.disconnect();
});

function endpoint(action: 'recipients' | 'preview' | 'send'): string {
  return `${baseUrl}/api/v1/programs/${DIGEST_FIXTURE.notifyProgram}/mail/${action}`;
}

function post(action: 'preview' | 'send', body: object): Promise<Response> {
  return fetch(endpoint(action), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

it('lists all application statuses and sends a confirmed custom mail', async () => {
  await harness.prisma.team.update({
    where: { id: DIGEST_FIXTURE.offApplication },
    data: { status: 'REJECTED' },
  });
  const recipientsResponse = await fetch(endpoint('recipients'));
  const recipients: unknown = await recipientsResponse.json();
  expect(recipientsResponse.status).toBe(200);
  const serializedRecipients = JSON.stringify(recipients);
  expect(serializedRecipients).toContain(DIGEST_FIXTURE.notifyProgram);
  expect(serializedRecipients).toContain('"status":"APPROVED"');
  expect(serializedRecipients).toContain('"status":"REJECTED"');

  const draft = {
    subject: '프로그램 안내',
    body: '선택 학생에게 보내는 합성 본문',
    applicantIds: [DIGEST_FIXTURE.studentMissing],
  };
  const previewResponse = await post('preview', draft);
  const preview: unknown = await previewResponse.json();
  expect(previewResponse.status).toBe(201);
  expect(preview).toMatchObject({
    recipientCount: 1,
    renderedSubject: '[oss-hub] 프로그램 안내',
  });
  if (
    typeof preview !== 'object' ||
    preview === null ||
    !('previewedAt' in preview) ||
    !('previewVersion' in preview) ||
    typeof preview.previewedAt !== 'string' ||
    typeof preview.previewVersion !== 'string'
  ) {
    throw new TypeError('Invalid program mail preview');
  }

  const sendResponse = await post('send', {
    ...draft,
    previewedAt: preview.previewedAt,
    previewVersion: preview.previewVersion,
  });

  expect(sendResponse.status).toBe(201);
  await expect(sendResponse.json()).resolves.toMatchObject({ sentCount: 1 });
  expect(sender.sent).toEqual([
    expect.objectContaining({
      to: 'student-missing@example.com',
      subject: '[oss-hub] 프로그램 안내',
    }),
  ]);
});

it('rejects an applicant from outside the program before storing a notification', async () => {
  const response = await post('preview', {
    subject: '프로그램 안내',
    body: '합성 본문',
    applicantIds: [DIGEST_FIXTURE.staffOn],
  });

  expect(response.status).toBe(400);
  expect(sender.sent).toEqual([]);
  expect(
    await harness.prisma.notification.count({
      where: { type: 'PROGRAM_MAIL' },
    }),
  ).toBe(0);
});
