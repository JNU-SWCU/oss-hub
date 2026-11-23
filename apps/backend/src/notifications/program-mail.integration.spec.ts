import { createOwnedIntegrationDatabase } from '../../test/owned-integration-database.fixture';
import { randomBytes, randomUUID } from 'node:crypto';
import { createAuditLogReadService } from '../platform/audit-log-mapping.fixture';
import { AuditLogReadRepository } from '../platform/audit-log-read.repository';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import { DIGEST_FIXTURE } from './deadline-digest.integration-support';
import { registerProgramMailActiveLimitCase } from './program-mail-active-limit.integration-fixtures';
import { registerProgramMailAuditRecoveryCase } from './program-mail-audit-recovery.integration-fixtures';
import { registerProgramMailPendingRecoveryCase } from './program-mail-pending-recovery.integration-fixtures';
import { registerProgramMailConcurrencyCases } from './program-mail-concurrency.integration-fixtures';
import { registerProgramMailLeaseFencingCases } from './program-mail-lease-fencing.integration-fixtures';
import {
  PROGRAM_MAIL_STAFF_FIXTURE,
  startProgramMailIntegration,
  type ProgramMailIntegrationWorld,
} from './program-mail.integration-support';

import { PROGRAM_MAIL_RECIPIENT_LIMIT } from './program-mail.config';
import { ProgramMailService } from './program-mail.service';

const externalScope = randomUUID();
const externalGithubId = BigInt(randomBytes(6).readUIntBE(0, 6));
jest.setTimeout(30_000);

let world: ProgramMailIntegrationWorld;
let database:
  Awaited<ReturnType<typeof createOwnedIntegrationDatabase>> | undefined;

beforeAll(async () => {
  database = await createOwnedIntegrationDatabase();
  world = await startProgramMailIntegration(database.prisma);
}, 90_000);

beforeEach(async () => {
  await world.reset();
});

afterAll(async () => {
  try {
    await world?.close();
  } finally {
    await database?.close();
  }
});

it('keeps the digest fixture IDs outside the shared runner database', async () => {
  const sharedName = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
  const [current] = await world.prisma.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name LIMIT 1`;
  expect(current?.name).toEqual(expect.stringMatching(/^oss_hub_fixture_/));
  expect(current?.name).not.toBe(sharedName);
});

it('lists all application statuses, sends mail, and records an attributable audit event', async () => {
  await world.prisma.team.update({
    where: { id: DIGEST_FIXTURE.offApplication },
    data: { status: 'REJECTED' },
  });
  const cookie = await world.sessionCookie(PROGRAM_MAIL_STAFF_FIXTURE.githubId);
  const recipientsResponse = await fetch(world.endpoint('recipients'), {
    headers: { cookie },
  });
  const recipients: unknown = await recipientsResponse.json();
  expect(recipientsResponse.status).toBe(200);
  const serializedRecipients = JSON.stringify(recipients);
  expect(recipients).toMatchObject({
    programId: DIGEST_FIXTURE.notifyProgram,
    recipientLimit: PROGRAM_MAIL_RECIPIENT_LIMIT,
  });
  expect(serializedRecipients).toContain('"status":"APPROVED"');
  expect(serializedRecipients).toContain('"status":"REJECTED"');

  await world.enableJobs();
  const confirmed = await world.confirmedPreview(cookie);
  const sendResponse = await world.post('send', confirmed, cookie);

  expect(sendResponse.status).toBe(201);
  const queued: unknown = await sendResponse.json();
  if (
    !queued ||
    typeof queued !== 'object' ||
    !('jobId' in queued) ||
    typeof queued.jobId !== 'string'
  )
    throw new Error('Missing receipt ID');
  expect(queued).toMatchObject({ status: 'IN_PROGRESS', sentCount: 0 });
  expect(world.mailSender.sent).toEqual([]);
  await world.drain();
  const batch = await world.prisma.mailJob.findUniqueOrThrow({
    where: { id: queued.jobId },
    select: { id: true, createdAt: true, receiptFinishedAt: true },
  });
  const headers = { cookie };
  const list = await fetch(world.endpoint('jobs'), { headers });
  const item = { jobId: batch.id, acceptedAt: batch.createdAt.toISOString() };
  expect(await list.json()).toEqual({ items: [item] });
  const path = `jobs/${batch.id}`;
  const status = await fetch(world.endpoint(path), { headers });
  expect(status.headers.get('cache-control')).toBe('private, no-store');
  expect(await status.json()).toEqual({
    ...item,
    status: 'COMPLETED',
    finishedAt: batch.receiptFinishedAt?.toISOString(),
    source: 'PROGRAM_MANUAL',
    audiences: [
      {
        audience: 'STUDENT',
        sentCount: 1,
        failedCount: 0,
        unknownCount: 0,
        duplicateCount: 0,
        cancelledCount: 0,
      },
    ],
    sentCount: 1,
    failedCount: 0,
    unknownCount: 0,
    duplicateCount: 0,
  });
  expect(
    (
      await fetch(world.endpoint(path, DIGEST_FIXTURE.silentProgram), {
        headers,
      })
    ).status,
  ).toBe(404);
  expect((await fetch(world.endpoint('jobs/absent'), { headers })).status).toBe(
    404,
  );
  expect(world.mailSender.sent).toEqual([
    expect.objectContaining({
      to: 'student-missing@example.com',
      subject: '[oss-hub] 프로그램 안내',
    }),
  ]);
  const idempotencyKey = batch.id;
  const audit = await world.prisma.programHistory.findUnique({
    where: {
      sourceTable_sourceId: {
        sourceTable: 'MailJob',
        sourceId: `${batch.id}:result`,
      },
    },
    select: { actorId: true, occurredAt: true, data: true },
  });
  expect(audit?.actorId).toBe(PROGRAM_MAIL_STAFF_FIXTURE.id);
  expect(audit?.occurredAt).toBeInstanceOf(Date);
  expect(audit?.data).toMatchObject({
    schemaVersion: 1,
    action: 'PROGRAM_MAIL_SENT',
    requestId: idempotencyKey,
    metadata: {
      source: 'PROGRAM_MANUAL',
      actorType: 'USER',
      sentCount: 1,
      failedCount: 0,
      unknownCount: 0,
      duplicateCount: 0,
      audiences: { STUDENT: { sentCount: 1 }, STAFF: { sentCount: 0 } },
    },
  });
  const pageSize = 20;
  const unrelatedCount = 24;
  const newerThanOwned = new Date((audit?.occurredAt.getTime() ?? 0) + 1_000);
  const unrelatedActor = await world.prisma.user.create({
    data: canonicalUserCreateFromLabel('STAFF', {
      id: 'test:program-mail:foreign-audit-actor',
      githubId: 9_600_000_000_193_002n,
      nickname: `former-${PROGRAM_MAIL_STAFF_FIXTURE.nickname}`,
    }),
  });
  await world.prisma.userHistory.createMany({
    data: Array.from({ length: unrelatedCount }, (_, index) => {
      const batch = `program-mail-send:foreign-audit:${index}`;
      return {
        id: `user:program-mail-result:${batch}`,
        userId: unrelatedActor.id,
        actorId: unrelatedActor.id,
        event: 'PROFILE_UPDATED',
        source: 'APPLICATION',
        sourceTable: 'ProgramMail',
        sourceId: batch,
        sourcePart: 'RESULT',
        occurredAt: newerThanOwned,
        data: {
          schemaVersion: 1,
          recordKind: 'DOMAIN_EVENT',
          action: 'PROGRAM_MAIL_SENT',
          targetType: 'PROGRAM',
          targetId: DIGEST_FIXTURE.silentProgram,
          requestId: batch,
          metadata: {},
          request: null,
        },
      };
    }),
  });
  expect(
    await world.prisma.programHistory.count({
      where: {
        sourceTable: 'MailJob',
        sourceId: { in: [`${batch.id}:attempt`, `${batch.id}:result`] },
      },
    }),
  ).toBe(2);
  const readAudit = createAuditLogReadService(
    new AuditLogReadRepository(world.prisma),
  );
  const query = { action: 'PROGRAM_MAIL_SENT', limit: pageSize } as const;
  const firstPage = await readAudit.list({ ...query, page: 1 });
  expect(firstPage.total).toBeGreaterThan(pageSize);
  expect(
    firstPage.items.every(
      (item) => item.target.id === DIGEST_FIXTURE.silentProgram,
    ),
  ).toBe(true);

  const visibilityPageLimit = Math.min(
    10,
    Math.ceil(firstPage.total / pageSize),
  );
  let own = firstPage.items.find((item) => item.requestId === idempotencyKey);
  for (
    let page = 2;
    page <= visibilityPageLimit && own === undefined;
    page += 1
  ) {
    const next = await readAudit.list({ ...query, page });
    own = next.items.find((item) => item.requestId === idempotencyKey);
  }
  expect(own?.action).toBe('PROGRAM_MAIL_SENT');
  expect(own?.actor?.id).toBe(PROGRAM_MAIL_STAFF_FIXTURE.id);
  expect(own?.target.type).toBe('PROGRAM');
  expect(own?.target.id).toBe(DIGEST_FIXTURE.notifyProgram);
  expect(own?.requestId).toBe(idempotencyKey);
});

it('matches the legacy deadline recipient selection on approved teams only', async () => {
  await world.prisma.team.update({
    where: { id: DIGEST_FIXTURE.offApplication },
    data: { status: 'SUBMITTED' },
  });
  await world.prisma.team.update({
    where: { id: DIGEST_FIXTURE.deactivatedApplication },
    data: { status: 'REJECTED' },
  });
  const window = {
    from: DIGEST_FIXTURE.now,
    to: DIGEST_FIXTURE.windowEnd,
  };
  const audience = await world.findAudience(window);
  if (audience === null) throw new TypeError('Missing mail audience fixture');
  const quickSelection = audience.teams.flatMap((team) =>
    team.deadlineEligible
      ? team.applicants.flatMap((applicant) =>
          applicant.mailAvailable ? [applicant.id] : [],
        )
      : [],
  );
  const legacySelection = await world.legacyRecipientIds(window);

  expect(quickSelection.sort()).toEqual([...legacySelection].sort());
  expect(quickSelection).toEqual([DIGEST_FIXTURE.studentMissing]);
});

it.each([
  ['unauthenticated', null, 401],
  ['student', DIGEST_FIXTURE.studentMissing, 403],
  ['non-staff admin', DIGEST_FIXTURE.adminOn, 403],
] as const)(
  'rejects %s recipient reads through real HTTP guards',
  async (_label, userId, status) => {
    const cookie = userId === null ? null : await world.cookieForUser(userId);

    const recipients = jest.spyOn(ProgramMailService.prototype, 'recipients');
    try {
      const response = await fetch(world.endpoint('recipients'), {
        headers: cookie === null ? {} : { cookie },
      });
      expect(response.status).toBe(status);
      for (const path of ['jobs', 'jobs/absent']) {
        expect(
          (
            await fetch(world.endpoint(path), {
              headers: cookie === null ? {} : { cookie },
            })
          ).status,
        ).toBe(status);
      }
      expect(recipients).not.toHaveBeenCalled();
    } finally {
      recipients.mockRestore();
    }
    expect(world.mailSender.sent).toEqual([]);
    expect(
      await world.prisma.notification.count({
        where: { type: 'PROGRAM_MAIL' },
      }),
    ).toBe(0);
  },
);

it('rejects a recipient who belongs to another program', async () => {
  const externalUserId = `test:notifications:external-student:${externalScope}`;
  const externalTeamId = `test:notifications:external-team:${externalScope}`;
  try {
    await world.prisma.user.create({
      data: {
        ...canonicalUserCreateFromLabel('STUDENT', {
          id: externalUserId,
          githubId: externalGithubId,
          nickname: 'synthetic-external-student',
        }),
        notifyEnabled: true,
        notificationEmail: 'external-student@example.com',
      },
    });
    await world.prisma.team.create({
      data: {
        id: externalTeamId,
        programId: DIGEST_FIXTURE.silentProgram,
        name: 'external-team',
        leaderId: externalUserId,
        applicantId: externalUserId,
        answers: {},
        applicationTemplateVersion: 1,
        status: 'APPROVED',
      },
    });
    const response = await world.post(
      'preview',
      {
        subject: '프로그램 안내',
        body: '합성 본문',
        applicantIds: [externalUserId],
      },
      await world.sessionCookie(PROGRAM_MAIL_STAFF_FIXTURE.githubId),
    );

    expect(response.status).toBe(400);
    expect(world.mailSender.sent).toEqual([]);
  } finally {
    await world.prisma.team.deleteMany({ where: { id: externalTeamId } });
    await world.prisma.user.deleteMany({ where: { id: externalUserId } });
  }
});

registerProgramMailConcurrencyCases(() => world);
registerProgramMailActiveLimitCase(() => world);
registerProgramMailAuditRecoveryCase(() => world);
registerProgramMailPendingRecoveryCase(() => world);
registerProgramMailLeaseFencingCases(() => world);

it('revalidates program membership at send time', async () => {
  const cookie = await world.sessionCookie(PROGRAM_MAIL_STAFF_FIXTURE.githubId);
  const confirmed = await world.confirmedPreview(cookie);
  await world.prisma.team.update({
    where: { id: DIGEST_FIXTURE.missingApplication },
    data: { archivedAt: new Date('2026-11-18T00:00:00.000Z') },
  });

  await world.enableJobs();
  const response = await world.post('send', confirmed, cookie);

  expect(response.status).toBe(400);
  expect(world.mailSender.sent).toEqual([]);
  expect(
    await world.prisma.notification.count({
      where: { type: 'PROGRAM_MAIL' },
    }),
  ).toBe(0);
});
