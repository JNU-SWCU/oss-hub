import {
  ValidationPipe,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { DeadlineDigestController } from './deadline-digest.controller';
import { DeadlineDigestService } from './deadline-digest.service';
import {
  createDeadlineDigestIntegrationHarness,
  DIGEST_FIXTURE,
  RecordingMailSender,
} from './deadline-digest.integration-support';

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
  const moduleRef = await Test.createTestingModule({
    controllers: [DeadlineDigestController],
    providers: [
      { provide: DeadlineDigestService, useValue: harness.service(sender) },
    ],
  })
    .overrideGuard(SessionGuard)
    .useValue({
      canActivate(context: ExecutionContext) {
        context
          .switchToHttp()
          .getRequest<AuthenticatedRequest>().sessionGithubId = githubId;
        return true;
      },
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
  githubId = DIGEST_FIXTURE.staffOnGithub;
  await harness.prisma.milestone.update({
    where: { id: DIGEST_FIXTURE.notifyMilestone },
    data: {
      startAt: new Date(Date.now() - 3_600_000),
      dueAt: new Date(Date.now() + 12 * 3_600_000),
    },
  });
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
  // Given
  const draft = {
    studentGuidance: '<script>synthetic</script>\nstudent',
    staffGuidance: 'staff & only',
  };
  const preview = await confirmedPreview(draft);
  // When
  const response = await post('send', preview);
  // Then
  expect(response.status).toBe(201);
  expect(sender.sent).toHaveLength(3);
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
});

it('rejects changed guidance with 409 before creating any notification', async () => {
  // Given
  const preview = await confirmedPreview({
    studentGuidance: 'confirmed draft',
  });
  // When
  const response = await post('send', {
    ...preview,
    studentGuidance: 'different draft',
  });
  // Then
  expect(response.status).toBe(409);
  expect(sender.sent).toEqual([]);
  expect(
    await harness.prisma.notification.count({
      where: { type: 'DEADLINE_DIGEST' },
    }),
  ).toBe(0);
});

it('can refresh a drifted audience using the same draft without automatically sending', async () => {
  // Given
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
  // When
  const fresh = await confirmedPreview(draft);
  // Then
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
  // Given / When
  const response = await post('preview', draft);
  // Then
  expect(response.status).toBe(400);
  expect(sender.sent).toEqual([]);
});

it('keeps student callers outside the staff preview endpoint', async () => {
  // Given
  githubId = DIGEST_FIXTURE.studentMissingGithub;
  // When
  const response = await post('preview', {});
  // Then
  expect(response.status).toBe(403);
  expect(sender.sent).toEqual([]);
});

it('marks personalized previews as private and non-cacheable', async () => {
  // Given / When
  const response = await post('preview', {});
  // Then
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});

it('retains same-day deduplication across automatic and guided manual sends', async () => {
  // Given
  await harness.service(sender).sendDeadlineDigests();
  const preview = await confirmedPreview({
    studentGuidance: 'manual note',
    staffGuidance: 'staff note',
  });
  // When
  const first = await post('send', preview);
  const repeated = await post('send', preview);
  // Then
  expect(first.status).toBe(201);
  expect(await first.json()).toMatchObject({ sentCount: 0, duplicateCount: 1 });
  expect(repeated.status).toBe(201);
  expect(sender.sent).toHaveLength(3);
  expect(
    sender.sent.filter((mail) => mail.to === 'student-missing@example.com'),
  ).toHaveLength(1);
  expect(
    sender.sent.find((mail) => mail.to === 'student-missing@example.com')?.body,
  ).not.toContain('manual note');
});

it('does not claim or send when no milestone meets existing eligibility', async () => {
  // Given
  await harness.prisma.milestoneDocument.update({
    where: { id: DIGEST_FIXTURE.notifyDocument },
    data: { required: false },
  });
  // When
  const preview = await confirmedPreview({
    studentGuidance: 'unused guidance',
  });
  const response = await post('send', preview);
  // Then
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    recipientCount: 0,
    staffRecipientCount: 0,
    sentCount: 0,
  });
  expect(sender.sent).toEqual([]);
  expect(
    await harness.prisma.notification.count({
      where: { type: 'DEADLINE_DIGEST' },
    }),
  ).toBe(0);
});
