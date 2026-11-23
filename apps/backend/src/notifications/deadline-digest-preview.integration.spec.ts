import {
  ValidationPipe,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import { DeadlineDigestController } from './deadline-digest.controller';
import { DeadlineDigestService } from './deadline-digest.service';
import {
  createDeadlineDigestIntegrationHarness,
  DIGEST_FIXTURE,
  RecordingMailSender,
} from './deadline-digest.integration-support';
import {
  protectedRouteGuardStub,
  databaseSessionPrincipal,
} from '../../test/global-authentication-guard.fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const harness = createDeadlineDigestIntegrationHarness();
const sender = new RecordingMailSender();
let app: INestApplication;
let baseUrl = '';
let githubId: bigint = DIGEST_FIXTURE.staffOnGithub;

beforeAll(async () => {
  await harness.connect();
  const service = harness.service(sender);
  const moduleRef = await Test.createTestingModule({
    controllers: [DeadlineDigestController],
    providers: [
      protectedRouteGuardStub({
        async canActivate(context: ExecutionContext) {
          const request = context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>();
          request.sessionGithubId = githubId;
          Object.assign(request, {
            principal: await databaseSessionPrincipal(harness.prisma, githubId),
          });
          return true;
        },
      }),
      {
        provide: DeadlineDigestService,
        useValue: {
          previewProgramFromRequest: (programId, draft) =>
            service.previewProgram(programId, DIGEST_FIXTURE.now, draft),
          sendProgramFromPreview: (programId, preview, actorId) =>
            service.sendProgramFromPreview(
              programId,
              preview,
              actorId,
              DIGEST_FIXTURE.now,
            ),
        } satisfies Pick<
          DeadlineDigestService,
          'previewProgramFromRequest' | 'sendProgramFromPreview'
        >,
      },
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
  await harness.useJobs();
  sender.sent.length = 0;
  githubId = DIGEST_FIXTURE.staffOnGithub;
});
afterAll(async () => {
  await app.close();
  await harness.disconnect();
});

function post(action: 'preview' | 'send', body: object): Promise<Response> {
  return fetch(
    `${baseUrl}/api/v1/programs/${DIGEST_FIXTURE.notifyProgram}/deadline-digest/${action}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}
async function confirmedPreview(draft: object) {
  const response = await post('preview', draft);
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !('previewedAt' in value) ||
    !('previewVersion' in value) ||
    typeof value.previewedAt !== 'string' ||
    typeof value.previewVersion !== 'string'
  )
    throw new TypeError('Invalid synthetic preview');
  return {
    ...draft,
    previewedAt: value.previewedAt,
    previewVersion: value.previewVersion,
  };
}

it('renders, confirms, and sends separate escaped guidance through the real HTTP boundary', async () => {
  const draft = {
    studentGuidance: '<script>synthetic</script>\nstudent',
    staffGuidance: 'staff & only',
  };
  const preview = await confirmedPreview(draft);

  const response = await post('send', preview);

  expect(response.status).toBe(201);
  expect(sender.sent.map((mail) => mail.to).sort()).toEqual([
    'staff-on@example.com',
    'student-missing@example.com',
  ]);
  const student = sender.sent.find(
    (mail) => mail.to === 'student-missing@example.com',
  );
  expect(student?.body).toContain(draft.studentGuidance);
  expect(student?.html).not.toContain('<script>');
  expect(student?.html).toContain('&lt;script&gt;');
  expect(
    sender.sent
      .filter((mail) => mail.to !== 'student-missing@example.com')
      .every((mail) => mail.body.includes(draft.staffGuidance)),
  ).toBe(true);
  const audit = await harness.prisma.programHistory.findMany({
    take: 3,
    where: {
      sourceTable: 'MailJob',
      data: {
        path: ['metadata', 'previewVersion'],
        equals: preview.previewVersion,
      },
    },
    select: { actorId: true, sourceId: true, event: true, data: true },
    orderBy: { event: 'asc' },
  });
  expect(audit).toHaveLength(2);
  const requestId = audit[0]?.sourceId?.replace(/:attempt$/, '');
  expect(requestId).toEqual(expect.any(String));
  expect(audit.map((entry) => entry.actorId)).toEqual([
    DIGEST_FIXTURE.staffOn,
    DIGEST_FIXTURE.staffOn,
  ]);
  expect(audit.map((entry) => entry.event)).toEqual([
    'MAIL_ACCEPTED',
    'MAIL_COMPLETED',
  ]);
  expect(audit[0]?.data).toMatchObject({
    action: 'PROGRAM_MAIL_SEND_ATTEMPTED',
    schemaVersion: 1,
    requestId,
  });
  expect(audit[1]?.data).toMatchObject({
    action: 'PROGRAM_MAIL_SENT',
    schemaVersion: 1,
    requestId,
    metadata: {
      sentCount: 2,
      duplicateCount: 0,
      failedCount: 0,
    },
  });
});

it('rejects changed guidance with 409 before creating any notification', async () => {
  const preview = await confirmedPreview({
    studentGuidance: 'confirmed draft',
  });

  const response = await post('send', {
    ...preview,
    studentGuidance: 'different draft',
  });

  expect(response.status).toBe(409);
  expect(sender.sent).toEqual([]);
  expect(
    await harness.prisma.mailRecipient.count({
      where: { job: { programId: DIGEST_FIXTURE.notifyProgram } },
    }),
  ).toBe(0);
});

it('can refresh a drifted audience using the same draft without automatically sending', async () => {
  const draft = {
    studentGuidance: 'preserved draft',
    staffGuidance: 'preserved staff',
  };
  const preview = await confirmedPreview(draft);
  await harness.settingsRepository.updateByGithubId(
    DIGEST_FIXTURE.studentMissingGithub,
    { notificationEmail: 'changed@example.com', notifyEnabled: true },
  );
  expect((await post('send', preview)).status).toBe(409);

  const fresh = await confirmedPreview(draft);

  expect(fresh.previewVersion).not.toBe(preview.previewVersion);
  expect(sender.sent).toEqual([]);
  expect((await post('send', fresh)).status).toBe(201);
  expect(
    sender.sent.find((mail) => mail.to === 'changed@example.com')?.body,
  ).toContain(draft.studentGuidance);
});

it.each([
  ['non-text guidance', { studentGuidance: 1 }],
  ['null student guidance', { studentGuidance: null }],
  ['null staff guidance', { staffGuidance: null }],
  ['oversized guidance', { staffGuidance: 'x'.repeat(4001) }],
  ['protected subject', { subject: 'override' }],
] as const)('rejects unsupported draft input: %s', async (_label, draft) => {
  const response = await post('preview', draft);

  expect(response.status).toBe(400);
  expect(sender.sent).toEqual([]);
});

it('keeps student callers outside the staff preview endpoint', async () => {
  githubId = DIGEST_FIXTURE.studentMissingGithub;

  const response = await post('preview', {});

  expect(response.status).toBe(403);
  expect(sender.sent).toEqual([]);
});

it('marks personalized previews as private and non-cacheable', async () => {
  const response = await post('preview', {});

  expect(response.headers.get('cache-control')).toBe('private, no-store');
});

it('retains same-day deduplication across automatic and guided manual sends', async () => {
  await harness.service(sender).sendDeadlineDigests(DIGEST_FIXTURE.now);
  const preview = await confirmedPreview({
    studentGuidance: 'manual note',
    staffGuidance: 'staff note',
  });

  const first = await post('send', preview);
  const secondStaff = await harness.prisma.user.findUniqueOrThrow({
    where: { id: DIGEST_FIXTURE.staffOff },
    select: { githubId: true },
  });
  githubId = secondStaff.githubId;
  const repeated = await post('send', preview);

  expect(first.status).toBe(201);
  expect(await first.json()).toMatchObject({ sentCount: 0, duplicateCount: 1 });
  expect(repeated.status).toBe(201);
  expect(sender.sent.map((mail) => mail.to).sort()).toEqual([
    'staff-on@example.com',
    'student-missing@example.com',
  ]);
  expect(
    sender.sent.filter((mail) => mail.to === 'student-missing@example.com'),
  ).toHaveLength(1);
  expect(
    sender.sent.find((mail) => mail.to === 'student-missing@example.com')?.body,
  ).not.toContain('manual note');
  const results = await harness.prisma.programHistory.findMany({
    where: {
      sourceTable: 'MailJob',
      event: 'MAIL_COMPLETED',
      data: {
        path: ['metadata', 'previewVersion'],
        equals: preview.previewVersion,
      },
    },
    select: { actorId: true, sourceId: true },
    take: 3,
  });
  expect(results.map((row) => row.actorId).sort()).toEqual([
    DIGEST_FIXTURE.staffOff,
    DIGEST_FIXTURE.staffOn,
  ]);
  expect(new Set(results.map((row) => row.sourceId)).size).toBe(2);
});

it('does not claim or send when no milestone meets existing eligibility', async () => {
  await harness.prisma.requirement.update({
    where: { id: DIGEST_FIXTURE.notifyDocument },
    data: { required: false },
  });

  const preview = await confirmedPreview({
    studentGuidance: 'unused guidance',
  });
  const response = await post('send', preview);

  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    recipientCount: 0,
    staffRecipientCount: 0,
    sentCount: 0,
  });
  expect(sender.sent).toEqual([]);
  expect(
    await harness.prisma.mailRecipient.count({
      where: { job: { programId: DIGEST_FIXTURE.notifyProgram } },
    }),
  ).toBe(0);
});
