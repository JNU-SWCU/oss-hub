import {
  DIGEST_FIXTURE,
  RecordingMailSender,
} from './deadline-digest.integration-support';
import {
  ProgramMailAuditRepository,
  type ProgramMailAuditInput,
} from './program-mail-audit.repository';
import { ProgramMailDeliveryRepository } from './program-mail-delivery.repository';
import { ProgramMailDeliveryService } from './program-mail-delivery.service';
import { ProgramMailRepository } from './program-mail.repository';
import { ProgramMailSendRepository } from './program-mail-send.repository';
import type { ProgramMailIntegrationWorld } from './program-mail.integration-support';
import { ProgramMailService } from './program-mail.service';
import { ProgramMailTemplateService } from './program-mail-template.service';

class SyntheticAuditFailure extends Error {
  constructor() {
    super('Synthetic program mail audit failure');
    this.name = 'SyntheticAuditFailure';
  }
}

class FailingOnceProgramMailAuditRepository extends ProgramMailAuditRepository {
  private pendingFailure = true;

  override recordSend(
    input: ProgramMailAuditInput,
    transaction: Parameters<ProgramMailAuditRepository['recordSend']>[1],
  ): Promise<unknown> {
    if (this.pendingFailure) {
      this.pendingFailure = false;
      return Promise.reject(new SyntheticAuditFailure());
    }
    return super.recordSend(input, transaction);
  }
}

export function registerProgramMailAuditRecoveryCase(
  currentWorld: () => ProgramMailIntegrationWorld,
): void {
  it('recovers the owner result after audit persistence fails without resending', async () => {
    const world = currentWorld();
    const mailSender = new RecordingMailSender();
    const first = new ProgramMailService(
      new ProgramMailRepository(world.prisma),
      new ProgramMailDeliveryService(
        new ProgramMailSendRepository(
          world.prisma,
          new FailingOnceProgramMailAuditRepository(),
          new ProgramMailDeliveryRepository(world.prisma),
        ),
        mailSender,
        new ProgramMailTemplateService(),
      ),
    );
    const retry = world.createService(mailSender);
    const actor = await world.principal(DIGEST_FIXTURE.staffOnGithub);
    const now = new Date();
    const draft = {
      subject: '감사 복구',
      body: '감사 실패 뒤 결과 복구 본문',
      applicantIds: [DIGEST_FIXTURE.studentMissing],
    };
    const preview = await first.preview(
      DIGEST_FIXTURE.notifyProgram,
      actor,
      draft,
      now,
    );
    const request = { ...draft, ...preview };

    await expect(
      first.send(DIGEST_FIXTURE.notifyProgram, actor, request, now),
    ).rejects.toBeInstanceOf(SyntheticAuditFailure);
    expect(mailSender.sent).toHaveLength(1);

    await expect(
      retry.send(DIGEST_FIXTURE.notifyProgram, actor, request, now),
    ).resolves.toMatchObject({
      sentCount: 1,
      duplicateCount: 0,
      failedCount: 0,
    });
    expect(mailSender.sent).toHaveLength(1);
    const batchKey = `program-mail-send:${preview.previewVersion}`;
    expect(
      await world.prisma.userHistory.count({
        where: { sourceTable: 'ProgramMail', sourceId: batchKey },
      }),
    ).toBe(1);
  });
}
