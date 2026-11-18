import { createHash } from 'node:crypto';
import { DIGEST_FIXTURE } from './deadline-digest.integration-support';
import { ProgramMailAuditRepository } from './program-mail-audit.repository';
import { PROGRAM_MAIL_LEASE_MS } from './program-mail.config';
import { ProgramMailKeyRepository } from './program-mail-key.repository';
import { ProgramMailSendRepository } from './program-mail-send.repository';
import type { ProgramMailBatchContent } from './program-mail-send.types';
import type { ProgramMailIntegrationWorld } from './program-mail.integration-support';

export function registerProgramMailLeaseFencingCases(
  currentWorld: () => ProgramMailIntegrationWorld,
): void {
  it('fences expired workers from recipient results and batch completion', async () => {
    const world = currentWorld();
    const runtime = world.createRuntime(world.mailSender);
    const content = await batchContent(world, 'fence-result');
    const reservation = await reserve(world, content);
    if (reservation.kind !== 'OWNER') throw new Error('Expected batch owner');
    const oldWork = await runtime.batches.claim(
      reservation.batchKey,
      'worker-old',
      DIGEST_FIXTURE.now,
    );
    if ('kind' in oldWork) throw new Error('Expected old worker claim');
    const [recipient] = await runtime.deliveries.states(oldWork);
    if (recipient === undefined) throw new Error('Missing recipient state');
    expect(
      await runtime.deliveries.claim(oldWork, recipient, DIGEST_FIXTURE.now),
    ).toBe(true);

    const expiredAt = new Date(
      DIGEST_FIXTURE.now.getTime() + PROGRAM_MAIL_LEASE_MS + 1,
    );
    const newWork = await runtime.batches.claim(
      reservation.batchKey,
      'worker-new',
      expiredAt,
    );
    if ('kind' in newWork) throw new Error('Expected replacement worker claim');
    expect(newWork.leaseToken).not.toBe(oldWork.leaseToken);
    expect(
      await runtime.deliveries.complete({
        work: oldWork,
        state: recipient,
        status: 'SENT',
        now: expiredAt,
      }),
    ).toBe(false);
    expect(
      await runtime.deliveries.markUnknown(newWork, recipient, expiredAt),
    ).toBe(true);
    const result = await runtime.deliveries.result(newWork);
    expect(result).toEqual({
      sentCount: 0,
      duplicateCount: 0,
      failedCount: 0,
      unknownCount: 1,
    });
    if (result === null) throw new Error('Expected resolved result');
    await expect(
      runtime.batches.complete(oldWork, result, expiredAt),
    ).resolves.toEqual({
      kind: 'IN_PROGRESS',
      batchKey: reservation.batchKey,
    });
    await expect(
      runtime.batches.complete(newWork, result, expiredAt),
    ).resolves.toMatchObject({ kind: 'COMPLETED', result });
    const audit = await world.prisma.userHistory.findUniqueOrThrow({
      where: {
        id: `user:program-mail-result:${reservation.batchKey}`,
      },
      select: { data: true },
    });
    expect(audit.data).toMatchObject({
      metadata: { failedCount: 0, unknownCount: 1 },
    });
  });

  it('keeps at most two active leases after expiry and renewal', async () => {
    const world = currentWorld();
    const runtime = world.createRuntime(world.mailSender);
    const reservations = await Promise.all(
      ['active-fence-1', 'active-fence-2', 'active-fence-3'].map(
        async (suffix) => reserve(world, await batchContent(world, suffix)),
      ),
    );
    if (reservations.some((reservation) => reservation.kind !== 'OWNER')) {
      throw new Error('Expected fresh batch reservations');
    }
    const [first, second, third] = reservations.map(
      (reservation) => reservation.batchKey,
    );
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('Missing reserved batch key');
    }
    const firstWork = await runtime.batches.claim(
      first,
      'worker-first',
      DIGEST_FIXTURE.now,
    );
    const oldSecondWork = await runtime.batches.claim(
      second,
      'worker-second-old',
      DIGEST_FIXTURE.now,
    );
    if ('kind' in firstWork || 'kind' in oldSecondWork) {
      throw new Error('Expected initial active leases');
    }
    const beforeExpiry = new Date(
      DIGEST_FIXTURE.now.getTime() + PROGRAM_MAIL_LEASE_MS - 1,
    );
    const renewedFirst = await runtime.batches.renew(firstWork, beforeExpiry);
    if (renewedFirst === null) throw new Error('Expected lease renewal');
    const afterExpiry = new Date(
      DIGEST_FIXTURE.now.getTime() + PROGRAM_MAIL_LEASE_MS + 1,
    );
    const replacementSecond = await runtime.batches.claim(
      second,
      'worker-second-new',
      afterExpiry,
    );
    if ('kind' in replacementSecond) {
      throw new Error('Expected expired lease replacement');
    }
    expect(replacementSecond.leaseToken).not.toBe(oldSecondWork.leaseToken);
    await expect(
      runtime.batches.claim(third, 'worker-third', afterExpiry),
    ).resolves.toEqual({ kind: 'IN_PROGRESS', batchKey: third });
    const [active] = await world.prisma.$queryRaw<
      readonly { readonly count: number }[]
    >`
      SELECT count(*)::int AS count
      FROM "Notification"
      WHERE "type" = 'PROGRAM_MAIL_SEND'
        AND "status" = 'PROCESSING'
        AND COALESCE((payload->>'deliveryAllowed')::boolean, true)
        AND (payload->>'leaseExpiresAt')::timestamptz > ${afterExpiry}
      LIMIT 1
    `;
    expect(active?.count).toBe(2);
    const [recipient] = await runtime.deliveries.states(oldSecondWork);
    if (recipient === undefined) throw new Error('Missing recipient state');
    expect(
      await runtime.deliveries.claim(oldSecondWork, recipient, afterExpiry),
    ).toBe(false);
  });

  it('cancels queued mail instead of sending after program deletion', async () => {
    const world = currentWorld();
    const runtime = world.createRuntime(world.mailSender);
    const content = await batchContent(world, 'deleted-program');
    const reservation = await reserve(world, content);
    if (reservation.kind !== 'OWNER') throw new Error('Expected batch owner');
    await world.prisma.program.update({
      where: { id: DIGEST_FIXTURE.notifyProgram },
      data: { lifecycle: 'DELETED' },
    });
    try {
      await expect(
        runtime.worker.process(reservation.batchKey, () => DIGEST_FIXTURE.now),
      ).resolves.toMatchObject({
        kind: 'COMPLETED',
        result: { sentCount: 0, failedCount: 1, unknownCount: 0 },
      });
      expect(world.mailSender.sent).toHaveLength(0);
      const recipient = await world.prisma.notification.findFirstOrThrow({
        where: { type: 'PROGRAM_MAIL' },
        select: { payload: true },
      });
      expect(recipient.payload).toMatchObject({ code: 'PROGRAM_DELETED' });
    } finally {
      await world.prisma.program.update({
        where: { id: DIGEST_FIXTURE.notifyProgram },
        data: { lifecycle: 'PUBLISHED' },
      });
    }
  });
}

async function reserve(
  world: ProgramMailIntegrationWorld,
  content: ProgramMailBatchContent,
) {
  return new ProgramMailSendRepository(
    world.prisma,
    new ProgramMailAuditRepository(),
    new ProgramMailKeyRepository(),
  ).reserve(content);
}

async function batchContent(
  world: ProgramMailIntegrationWorld,
  suffix: string,
): Promise<ProgramMailBatchContent> {
  const principal = await world.principal(DIGEST_FIXTURE.staffOnGithub);
  const audience = await world.findAudience({
    from: new Date(DIGEST_FIXTURE.now.getTime() - 1),
    to: new Date(DIGEST_FIXTURE.now.getTime() + 1),
  });
  const recipient = audience?.teams
    .flatMap((team) => team.applicants)
    .find((applicant) => applicant.notificationEmail !== null);
  if (
    audience === null ||
    recipient === undefined ||
    recipient.notificationEmail === null
  ) {
    throw new Error('Missing program mail integration fixture');
  }
  const body = `본문-${suffix}`;
  return {
    actorId: principal.id,
    programId: audience.id,
    programName: audience.name,
    senderName: principal.name ?? principal.nickname,
    recipients: [
      {
        id: recipient.id,
        displayName: recipient.displayName,
        notificationEmail: recipient.notificationEmail,
      },
    ],
    subject: `제목-${suffix}`,
    body,
    bodyHash: createHash('sha256').update(body).digest('hex'),
    bodyLength: body.length,
    previewVersion: `preview-${suffix}`,
    occurredAt: DIGEST_FIXTURE.now,
  };
}
