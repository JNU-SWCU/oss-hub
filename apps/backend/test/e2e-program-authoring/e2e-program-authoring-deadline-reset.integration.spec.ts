import {
  digestRuntime,
  useJobs,
} from '../../src/notifications/mail-job-runtime.fixture';
import { TEST_READ_LIMIT } from '../test-read-limit.config';
import { MemberKind } from '../../src/users/user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../integration-database.guard';
import { PrismaService } from '../../src/platform/prisma.service';
import { canonicalUserCreate } from '../../src/users/canonical-user-fixture';
import { e2eProgramAuthoringExternalPorts } from './e2e-external-ports';
import {
  E2E_NOW,
  E2E_STAFF_ID,
  E2E_PROGRAM_ID,
  E2E_STUDENT_ID,
  E2eProgramAuthoringFixture,
} from './e2e-program-authoring-fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const fixture = new E2eProgramAuthoringFixture(prisma);
const staffId = 'test:e2e-deadline-reset:global-staff';
const service = digestRuntime(
  prisma,
  e2eProgramAuthoringExternalPorts.mail,
  E2E_NOW,
);

beforeAll(async () => {
  await prisma.$connect();
  await prisma.user.create({
    data: {
      ...canonicalUserCreate({
        id: staffId,
        githubId: 8100091n,
        nickname: 'synthetic-global-staff',
        memberKind: MemberKind.STAFF,
        hasStaffAccess: true,
      }),
      notifyEnabled: true,
      notificationEmail: 'global-staff@fixture.invalid',
    },
  });
});

afterEach(async () => {
  await fixture.reset();
  await prisma.mailControl.update({
    where: { id: 1 },
    data: { mode: 'PAUSED' },
  });
  await prisma.mailControl.update({
    where: { id: 1 },
    data: { mode: 'LEGACY' },
  });
  await prisma.notification.deleteMany({ where: { userId: staffId } });
  e2eProgramAuthoringExternalPorts.reset();
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: staffId } });
  await prisma.$disconnect();
});

async function ensureMissingSubmission(): Promise<void> {
  await fixture.ensure();
  const team = await prisma.team.create({
    data: {
      programId: E2E_PROGRAM_ID,
      name: 'synthetic-reset-team',
      leaderId: E2E_STUDENT_ID,
      members: {
        create: { userId: E2E_STUDENT_ID },
      },
      applicantId: E2E_STUDENT_ID,
      answers: { title: 'synthetic-reset-team' },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.team.update({
    where: { id: team.id },
    data: {
      programId: E2E_PROGRAM_ID,
      applicantId: E2E_STUDENT_ID,
      status: 'APPROVED',
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
}

async function sendDigest(): Promise<void> {
  const preview = await service.previewProgram(E2E_PROGRAM_ID, E2E_NOW);
  expect(preview).toMatchObject({ recipientCount: 1, staffRecipientCount: 1 });
  await service.sendProgramFromPreview(
    E2E_PROGRAM_ID,
    preview,
    E2E_STAFF_ID,
    E2E_NOW,
  );
}

it('resets global staff daily claims so the next isolated scenario sends again', async () => {
  await useJobs(prisma);
  await ensureMissingSubmission();
  await sendDigest();
  expect(e2eProgramAuthoringExternalPorts.capture().mail.envelopeCount).toBe(2);
  const before = await prisma.mailRecipient.findMany({
    take: TEST_READ_LIMIT,
    where: { userId: staffId },
    select: { state: true, deliveryKey: true },
  });
  expect(before).toHaveLength(1);
  expect(before[0]?.state).toBe('SENT');
  expect(before[0]?.deliveryKey).toContain(E2E_PROGRAM_ID);

  await fixture.reset();
  e2eProgramAuthoringExternalPorts.reset();
  await expect(
    prisma.mailRecipient.count({ where: { userId: staffId } }),
  ).resolves.toBe(0);
  expect(e2eProgramAuthoringExternalPorts.capture().mail.envelopeCount).toBe(0);

  await ensureMissingSubmission();
  await sendDigest();
  expect(e2eProgramAuthoringExternalPorts.capture().mail.envelopeCount).toBe(2);
  await expect(
    prisma.mailRecipient.findMany({
      take: TEST_READ_LIMIT,
      where: { userId: staffId },
      select: { state: true, deliveryKey: true },
    }),
  ).resolves.toEqual(before);
});

it('preserves other programs and non-deadline claims for the same global staff', async () => {
  const preserved = [
    `deadline-digest-staff:2026-09-07:other:${E2E_PROGRAM_ID}:${staffId}`,
    `deadline-digest:2026-09-07:${E2E_PROGRAM_ID}-other:${staffId}`,
    `other:2026-09-07:${E2E_PROGRAM_ID}:${staffId}`,
  ];
  await prisma.notification.createMany({
    data: preserved.map((idempotencyKey) => ({
      userId: staffId,
      type: 'DEADLINE_DIGEST',
      channel: 'EMAIL',
      status: 'SENT',
      payload: {},
      idempotencyKey,
    })),
  });
  await fixture.reset();
  const after = await prisma.notification.findMany({
    take: TEST_READ_LIMIT,
    where: { userId: staffId },
    select: { idempotencyKey: true },
  });
  expect(after.map((row) => row.idempotencyKey).sort()).toEqual(
    preserved.sort(),
  );
});
