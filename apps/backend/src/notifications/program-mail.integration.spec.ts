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

import { ProgramMailService } from './program-mail.service';

const externalScope = randomUUID();
const externalGithubId = BigInt(randomBytes(6).readUIntBE(0, 6));
jest.setTimeout(30_000);

let world: ProgramMailIntegrationWorld;

beforeAll(async () => {
  world = await startProgramMailIntegration();
});

beforeEach(async () => {
  await world.reset();
});

afterAll(async () => {
  await world?.close();
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
  expect(recipients).toMatchObject({ programId: DIGEST_FIXTURE.notifyProgram });
  expect(serializedRecipients).toContain('"status":"APPROVED"');
  expect(serializedRecipients).toContain('"status":"REJECTED"');

  const confirmed = await world.confirmedPreview(cookie);
  const sendResponse = await world.post('send', confirmed, cookie);

  expect(sendResponse.status).toBe(201);
  await expect(sendResponse.json()).resolves.toMatchObject({ sentCount: 1 });
  expect(world.mailSender.sent).toEqual([
    expect.objectContaining({
      to: 'student-missing@example.com',
      subject: '[oss-hub] 프로그램 안내',
    }),
  ]);
  const idempotencyKey = `program-mail-send:${confirmed.previewVersion}`;
  const audit = await world.prisma.userHistory.findUnique({
    where: { id: `user:program-mail-result:${idempotencyKey}` },
    select: { actorId: true, occurredAt: true, data: true },
  });
  expect(audit?.actorId).toBe(PROGRAM_MAIL_STAFF_FIXTURE.id);
  expect(audit?.occurredAt).toBeInstanceOf(Date);
  expect(
    await world.prisma.userHistory.count({
      where: { sourceTable: 'ProgramMail', sourceId: idempotencyKey },
    }),
  ).toBe(2);
  expect(audit?.data).toMatchObject({
    recordKind: 'DOMAIN_EVENT',
    action: 'PROGRAM_MAIL_SENT',
    targetType: 'PROGRAM',
    targetId: DIGEST_FIXTURE.notifyProgram,
    requestId: idempotencyKey,
    metadata: {
      recipientCount: 1,
      recipientIds: [DIGEST_FIXTURE.studentMissing],
      subject: '프로그램 안내',
      bodyLength: confirmed.body.length,
      idempotencyKey,
    },
  });
  const feed = await createAuditLogReadService(
    new AuditLogReadRepository(world.prisma),
  ).list({ action: 'PROGRAM_MAIL_SENT', page: 1, limit: 20 });
  expect(feed.items).toHaveLength(1);
  expect(feed.items[0]?.action).toBe('PROGRAM_MAIL_SENT');
  expect(feed.items[0]?.actor?.id).toBe(PROGRAM_MAIL_STAFF_FIXTURE.id);
  expect(feed.items[0]?.target.type).toBe('PROGRAM');
  expect(feed.items[0]?.target.id).toBe(DIGEST_FIXTURE.notifyProgram);
  expect(feed.items[0]?.requestId).toBe(idempotencyKey);
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

  const response = await world.post('send', confirmed, cookie);

  expect(response.status).toBe(400);
  expect(world.mailSender.sent).toEqual([]);
  expect(
    await world.prisma.notification.count({
      where: { type: 'PROGRAM_MAIL' },
    }),
  ).toBe(0);
});
