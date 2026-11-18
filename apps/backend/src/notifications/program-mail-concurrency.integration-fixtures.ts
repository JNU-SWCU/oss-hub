import type { ActiveAccountPrincipal } from '../auth/http-auth.types';
import { SequentialRepository } from '../platform/sequential.repository';
import {
  DIGEST_FIXTURE,
  RecordingMailSender,
} from './deadline-digest.integration-support';
import type { MailSender } from './gmail-mail.client';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import type { ProgramMailIntegrationWorld } from './program-mail.integration-support';
import type { ProgramMailService } from './program-mail.service';

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

async function bounded(event: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Program mail concurrency event timed out')),
      5000,
    );
  });
  try {
    await Promise.race([event, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function sendFresh(
  service: ProgramMailService,
  actor: ActiveAccountPrincipal,
  index: number,
  prefix: string,
): Promise<void> {
  const now = new Date(Date.now() + index);
  const draft = {
    subject: `${prefix}-${index}`,
    body: '공유 한도 합성 본문',
    applicantIds: [DIGEST_FIXTURE.studentMissing],
  };
  const preview = await service.preview(
    DIGEST_FIXTURE.notifyProgram,
    actor,
    draft,
    now,
  );
  await service.send(
    DIGEST_FIXTURE.notifyProgram,
    actor,
    { ...draft, ...preview },
    now,
  );
}

class BarrierMailSender implements MailSender {
  readonly entered = deferred();
  readonly released = deferred();
  attempts = 0;

  send(): Promise<void> {
    this.attempts += 1;
    this.entered.resolve();
    return this.released.promise;
  }
}

async function waitForAdvisoryWaiter(
  world: ProgramMailIntegrationWorld,
): Promise<void> {
  let found = false;
  await new SequentialRepository().repeat(100, async () => {
    const [row] = await world.prisma.$queryRaw<
      readonly { readonly count: number }[]
    >`
      SELECT count(*)::int AS count
      FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted
      LIMIT 1
    `;
    if ((row?.count ?? 0) === 0) return;
    found = true;
    return 'stop';
  });
  if (!found) throw new Error('Second send did not wait on the advisory lock');
}

export function registerProgramMailConcurrencyCases(
  currentWorld: () => ProgramMailIntegrationWorld,
): void {
  it('shares the per-staff rate limit across independent service instances', async () => {
    const world = currentWorld();
    const actor = await world.principal(DIGEST_FIXTURE.staffOnGithub);
    const first = world.createService(new RecordingMailSender());
    const second = world.createService(new RecordingMailSender());
    await sendFresh(first, actor, 1, 'shared-staff');
    await sendFresh(second, actor, 2, 'shared-staff');
    await sendFresh(first, actor, 3, 'shared-staff');

    await expect(
      sendFresh(second, actor, 4, 'shared-staff'),
    ).rejects.toMatchObject({
      errorCode:
        NOTIFICATIONS_ERROR_CODES[
          NotificationsErrorCode.PROGRAM_MAIL_RATE_LIMITED
        ],
    });
    expect(
      await world.prisma.notification.count({
        where: {
          type: 'PROGRAM_MAIL_SEND',
          userId: DIGEST_FIXTURE.staffOn,
        },
      }),
    ).toBe(3);
  });

  it('shares the per-program rate limit across independent staff instances', async () => {
    const world = currentWorld();
    const firstActor = await world.principal(DIGEST_FIXTURE.staffOnGithub);
    const secondActor = await world.principal(
      (
        await world.prisma.user.findUniqueOrThrow({
          where: { id: DIGEST_FIXTURE.staffOff },
          select: { githubId: true },
        })
      ).githubId,
    );
    const first = world.createService(new RecordingMailSender());
    const second = world.createService(new RecordingMailSender());
    await sendFresh(first, firstActor, 11, 'shared-program');
    await sendFresh(first, firstActor, 12, 'shared-program');
    await sendFresh(first, firstActor, 13, 'shared-program');
    await sendFresh(second, secondActor, 14, 'shared-program');
    await sendFresh(second, secondActor, 15, 'shared-program');

    await expect(
      sendFresh(second, secondActor, 16, 'shared-program'),
    ).rejects.toMatchObject({
      errorCode:
        NOTIFICATIONS_ERROR_CODES[
          NotificationsErrorCode.PROGRAM_MAIL_RATE_LIMITED
        ],
    });
    expect(
      await world.prisma.notification.count({
        where: {
          type: 'PROGRAM_MAIL_SEND',
          payload: {
            path: ['programId'],
            equals: DIGEST_FIXTURE.notifyProgram,
          },
        },
      }),
    ).toBe(5);
  });

  it('makes an overlapping duplicate wait for the owner final result and audit', async () => {
    const world = currentWorld();
    const actor = await world.principal(DIGEST_FIXTURE.staffOnGithub);
    const barrier = new BarrierMailSender();
    const firstService = world.createService(barrier);
    const secondService = world.createService(barrier);
    const now = new Date();
    const draft = {
      subject: '겹치는 확인',
      body: '감사 결과 경쟁 회귀 본문',
      applicantIds: [DIGEST_FIXTURE.studentMissing],
    };
    const preview = await firstService.preview(
      DIGEST_FIXTURE.notifyProgram,
      actor,
      draft,
      now,
    );
    const request = { ...draft, ...preview };
    const first = firstService.send(
      DIGEST_FIXTURE.notifyProgram,
      actor,
      request,
      now,
    );
    await bounded(barrier.entered.promise);
    const duplicate = secondService.send(
      DIGEST_FIXTURE.notifyProgram,
      actor,
      request,
      now,
    );
    await bounded(waitForAdvisoryWaiter(world));

    barrier.released.resolve();
    const [firstResult, duplicateResult] = await Promise.all([
      first,
      duplicate,
    ]);

    expect(firstResult).toEqual({
      sentCount: 1,
      duplicateCount: 0,
      failedCount: 0,
      previewVersion: preview.previewVersion,
    });
    expect(duplicateResult).toEqual(firstResult);
    expect(barrier.attempts).toBe(1);
    const batchKey = `program-mail-send:${preview.previewVersion}`;
    expect(
      await world.prisma.userHistory.count({
        where: { sourceTable: 'ProgramMail', sourceId: batchKey },
      }),
    ).toBe(1);
    const audit = await world.prisma.userHistory.findUnique({
      where: { id: `user:program-mail:${batchKey}` },
      select: { data: true },
    });
    expect(audit?.data).toMatchObject({
      metadata: { sentCount: 1, duplicateCount: 0, failedCount: 0 },
    });
  });
}
