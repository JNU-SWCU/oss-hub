import {
  DIGEST_FIXTURE,
  IsolatingMailSender,
} from './deadline-digest.integration-support';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import { ProgramMailAuditRepository } from './program-mail-audit.repository';
import type {
  ProgramMailSendRequest,
  BridgeProgramMailService as ProgramMailService,
} from './program-mail-bridge-v131.fixture';
import { type ProgramMailIntegrationWorld } from './program-mail.integration-support';
import { createAuditLogReadService } from '../platform/audit-log-mapping.fixture';
import { AuditLogReadRepository } from '../platform/audit-log-read.repository';

const programId = DIGEST_FIXTURE.silentProgram;
const recoveryTeamId = 'test:program-mail:audit-recovery-team';

class FailingOnceAuditRepository extends ProgramMailAuditRepository {
  private shouldFail = true;

  override recordResult(
    command: Parameters<ProgramMailAuditRepository['recordResult']>[0],
    transaction: Parameters<ProgramMailAuditRepository['recordResult']>[1],
  ): Promise<unknown> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error('injected audit completion failure');
    }
    return super.recordResult(command, transaction);
  }
}

export function registerProgramMailAuditRecoveryCase(
  currentWorld: () => ProgramMailIntegrationWorld,
): void {
  describe('partial failure recovery', () => {
    beforeAll(async () => {
      await currentWorld().prisma.team.create({
        data: {
          id: recoveryTeamId,
          name: 'audit recovery',
          programId,
          leaderId: DIGEST_FIXTURE.studentMissing,
          applicantId: DIGEST_FIXTURE.studentMissing,
          answers: {},
          applicationTemplateVersion: 1,
          status: 'APPROVED',
          members: { create: { userId: DIGEST_FIXTURE.studentSubmitted } },
        },
      });
    });
    afterAll(async () => {
      await currentWorld().prisma.teamMember.deleteMany({
        where: { teamId: recoveryTeamId },
      });
      await currentWorld().prisma.team.delete({
        where: { id: recoveryTeamId },
      });
    });
    it('keeps rate accounting and persists one partial failure result after recovery and replay', async () => {
      const world = currentWorld();
      const principal = await world.principal(DIGEST_FIXTURE.staffOnGithub);
      const regular = world.createRuntime(world.mailSender);
      const sender = new IsolatingMailSender();
      const failing = world.createRuntime(
        sender,
        new FailingOnceAuditRepository(),
      );
      await world.prisma.notification.createMany({
        data: ['rate-1', 'rate-2'].map((key) => ({
          userId: principal.id,
          idempotencyKey: `${recoveryTeamId}:${key}`,
          type: 'PROGRAM_MAIL_SEND',
          channel: 'INTERNAL',
          status: 'COMPLETED',
          createdAt: DIGEST_FIXTURE.now,
          payload: { programId },
        })),
      });

      const third = await request(failing.service, principal, 'rate-3', [
        DIGEST_FIXTURE.studentMissing,
        DIGEST_FIXTURE.studentSubmitted,
      ]);
      await expect(
        failing.service.send(programId, principal, third, DIGEST_FIXTURE.now),
      ).rejects.toThrow('injected audit completion failure');
      expect(sender.attempted).toHaveLength(2);

      await expect(
        send(regular.service, principal, 'rate-4'),
      ).rejects.toMatchObject({
        errorCode:
          NOTIFICATIONS_ERROR_CODES[
            NotificationsErrorCode.PROGRAM_MAIL_RATE_LIMITED
          ],
      });
      await expect(
        failing.service.send(programId, principal, third, DIGEST_FIXTURE.now),
      ).resolves.toMatchObject({ status: 'IN_PROGRESS', sentCount: 0 });

      const batchKey = `program-mail-send:${third.previewVersion}`;
      const batch = await world.prisma.notification.findUniqueOrThrow({
        where: { idempotencyKey: batchKey },
        select: { payload: true },
      });
      const leaseExpiresAt =
        batch.payload !== null &&
        typeof batch.payload === 'object' &&
        !Array.isArray(batch.payload) &&
        typeof batch.payload.leaseExpiresAt === 'string'
          ? new Date(batch.payload.leaseExpiresAt)
          : null;
      if (leaseExpiresAt === null) throw new Error('Missing batch lease');
      const recoveredAt = new Date(leaseExpiresAt.getTime() + 1);
      const recovered = await failing.worker.process(
        batchKey,
        () => recoveredAt,
      );
      expect(recovered).toEqual({
        kind: 'COMPLETED',
        batchKey,
        result: {
          sentCount: 1,
          duplicateCount: 0,
          failedCount: 1,
          unknownCount: 0,
        },
      });
      expect(sender.attempted).toHaveLength(2);

      await expect(
        failing.service.send(programId, principal, third, DIGEST_FIXTURE.now),
      ).resolves.toMatchObject({
        status: 'COMPLETED',
        sentCount: 1,
        failedCount: 1,
      });
      expect(sender.attempted).toHaveLength(2);
      const audit = await world.prisma.userHistory.findMany({
        take: 3,
        where: { sourceTable: 'ProgramMail', sourceId: batchKey },
        select: { sourcePart: true, actorId: true, data: true },
        orderBy: { sourcePart: 'asc' },
      });
      expect(audit).toMatchObject([
        {
          sourcePart: 'attempt',
          actorId: principal.id,
          data: { action: 'PROGRAM_MAIL_SEND_ATTEMPTED' },
        },
        {
          sourcePart: 'result',
          actorId: principal.id,
          data: {
            action: 'PROGRAM_MAIL_PARTIALLY_FAILED',
            metadata: {
              sentCount: 1,
              failedCount: 1,
              unknownCount: 0,
              duplicateCount: 0,
            },
          },
        },
      ]);
      const feed = await createAuditLogReadService(
        new AuditLogReadRepository(world.prisma),
      ).list({
        action: 'PROGRAM_MAIL_PARTIALLY_FAILED',
        page: 1,
        limit: 20,
      });
      expect(
        feed.items.filter((entry) => entry.requestId === batchKey),
      ).toMatchObject([
        {
          action: 'PROGRAM_MAIL_PARTIALLY_FAILED',
          actor: { id: principal.id },
          target: { id: programId },
          metadata: { sentCount: 1, failedCount: 1, unknownCount: 0 },
        },
      ]);
    });
  });
}

async function send(
  service: ProgramMailService,
  principal: Awaited<ReturnType<ProgramMailIntegrationWorld['principal']>>,
  subject: string,
): Promise<Awaited<ReturnType<ProgramMailService['send']>>> {
  const prepared = await request(service, principal, subject);
  return service.send(programId, principal, prepared, DIGEST_FIXTURE.now);
}

async function request(
  service: ProgramMailService,
  principal: Awaited<ReturnType<ProgramMailIntegrationWorld['principal']>>,
  subject: string,
  applicantIds: readonly string[] = [DIGEST_FIXTURE.studentMissing],
): Promise<ProgramMailSendRequest> {
  const draft = { subject, body: '본문', applicantIds };
  const preview = await service.preview(
    programId,
    principal,
    draft,
    DIGEST_FIXTURE.now,
  );
  return { ...draft, ...preview };
}
