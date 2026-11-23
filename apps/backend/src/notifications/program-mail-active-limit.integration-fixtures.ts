import type { MailSender } from './gmail-mail.client';
import { DIGEST_FIXTURE } from './deadline-digest.integration-support';
import type { BridgeProgramMailService as ProgramMailService } from './program-mail-bridge-v131.fixture';
import {
  PROGRAM_MAIL_STAFF_FIXTURE,
  type ProgramMailIntegrationWorld,
} from './program-mail.integration-support';

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function bounded<T>(event: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Program mail worker event timed out')),
      5000,
    );
  });
  try {
    return await Promise.race([event, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function registerProgramMailActiveLimitCase(
  currentWorld: () => ProgramMailIntegrationWorld,
): void {
  it('keeps mail I/O outside transactions and shares active leases', async () => {
    const world = currentWorld();
    const entered = deferred();
    const release = deferred();
    let activeDeliveries = 0;
    const sender: MailSender = {
      send: async () => {
        activeDeliveries += 1;
        if (activeDeliveries === 2) entered.resolve();
        await release.promise;
      },
    };
    const principal = await world.principal(
      PROGRAM_MAIL_STAFF_FIXTURE.githubId,
    );
    const [firstService, secondService, thirdService] = [
      world.createService(sender),
      world.createService(sender),
      world.createService(sender),
    ] as const;
    const first = send(firstService, principal, 'active-1');
    const second = send(secondService, principal, 'active-2');
    try {
      await bounded(entered.promise);

      const [poolState] = await bounded(
        world.prisma.$queryRaw<
          readonly { readonly idleInTransaction: number }[]
        >`
        SELECT count(*)::int AS "idleInTransaction"
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND state = 'idle in transaction'
        LIMIT 1
      `,
      );
      expect(poolState?.idleInTransaction).toBe(0);
      await expect(
        send(thirdService, principal, 'active-3'),
      ).resolves.toMatchObject({ status: 'IN_PROGRESS', sentCount: 0 });
    } finally {
      release.resolve();
      await Promise.allSettled([first, second]);
    }
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'COMPLETED', sentCount: 1 }),
      expect.objectContaining({ status: 'COMPLETED', sentCount: 1 }),
    ]);
  });
}

async function send(
  service: ProgramMailService,
  principal: Awaited<ReturnType<ProgramMailIntegrationWorld['principal']>>,
  subject: string,
): Promise<Awaited<ReturnType<ProgramMailService['send']>>> {
  const now = DIGEST_FIXTURE.now;
  const recipients = await service.recipients(
    DIGEST_FIXTURE.notifyProgram,
    now,
  );
  const applicant = recipients.teams
    .flatMap((team) => team.applicants)
    .find((candidate) => candidate.mailAvailable);
  if (applicant === undefined)
    throw new Error('Missing mail recipient fixture');
  const preview = await service.preview(
    DIGEST_FIXTURE.notifyProgram,
    principal,
    { subject, body: '본문', applicantIds: [applicant.id] },
    now,
  );
  return service.send(
    DIGEST_FIXTURE.notifyProgram,
    principal,
    {
      subject,
      body: '본문',
      applicantIds: [applicant.id],
      previewedAt: preview.previewedAt,
      previewVersion: preview.previewVersion,
    },
    now,
  );
}
