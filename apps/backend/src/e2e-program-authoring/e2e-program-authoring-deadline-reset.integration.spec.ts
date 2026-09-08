import { MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalUserCreate } from '../users/canonical-user-fixture';
import { DeadlineDigestRepository } from '../notifications/deadline-digest.repository';
import { DeadlineDigestService } from '../notifications/deadline-digest.service';
import { e2eProgramAuthoringExternalPorts } from './e2e-external-ports';
import {
  E2E_NOW,
  E2E_PROGRAM_ID,
  E2E_STAFF_GITHUB_ID,
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
const service = new DeadlineDigestService(
  new DeadlineDigestRepository(prisma),
  e2eProgramAuthoringExternalPorts.mail,
  { FRONTEND_URL: 'https://oss.example' },
);

beforeAll(async () => {
  await prisma.$connect();
  await prisma.user.create({
    data: {
      ...canonicalUserCreate({
        id: staffId,
        githubId: 8_100_091n,
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
      joinCodeDigest: 'synthetic-reset-team-digest',
      leaderId: E2E_STUDENT_ID,
      members: {
        create: { userId: E2E_STUDENT_ID },
      },
    },
  });
  await prisma.application.create({
    data: {
      programId: E2E_PROGRAM_ID,
      applicantId: E2E_STUDENT_ID,
      teamId: team.id,
      status: 'APPROVED',
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
}

async function sendDigest(): Promise<void> {
  const preview = await service.previewProgram(
    E2E_STAFF_GITHUB_ID,
    E2E_PROGRAM_ID,
    E2E_NOW,
  );
  expect(preview).toMatchObject({ recipientCount: 1, staffRecipientCount: 1 });
  await service.sendProgramFromPreview(
    E2E_STAFF_GITHUB_ID,
    E2E_PROGRAM_ID,
    preview,
    E2E_NOW,
  );
}

it('resets global staff daily claims so the next isolated scenario sends again', async () => {
  await ensureMissingSubmission();
  await sendDigest();
  expect(e2eProgramAuthoringExternalPorts.capture().mail.envelopeCount).toBe(2);
  const before = await prisma.notification.findMany({
    where: { userId: staffId },
    select: { status: true, idempotencyKey: true },
  });
  expect(before).toHaveLength(1);
  expect(before[0]?.status).toBe('SENT');
  expect(before[0]?.idempotencyKey).toContain(E2E_PROGRAM_ID);

  await fixture.reset();
  e2eProgramAuthoringExternalPorts.reset();
  await expect(
    prisma.notification.count({ where: { userId: staffId } }),
  ).resolves.toBe(0);
  expect(e2eProgramAuthoringExternalPorts.capture().mail.envelopeCount).toBe(0);

  await ensureMissingSubmission();
  await sendDigest();
  expect(e2eProgramAuthoringExternalPorts.capture().mail.envelopeCount).toBe(2);
  await expect(
    prisma.notification.findMany({
      where: { userId: staffId },
      select: { status: true, idempotencyKey: true },
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
    where: { userId: staffId },
    select: { idempotencyKey: true },
  });
  expect(after.map((row) => row.idempotencyKey).sort()).toEqual(
    preserved.sort(),
  );
});
