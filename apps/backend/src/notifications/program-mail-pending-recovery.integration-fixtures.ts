import { createHash } from 'node:crypto';
import { DIGEST_FIXTURE } from './deadline-digest.integration-support';
import { ProgramMailAuditRepository } from './program-mail-audit.repository';
import { ProgramMailKeyRepository } from './program-mail-key.repository';
import { ProgramMailSendRepository } from './program-mail-send.repository';
import type { ProgramMailIntegrationWorld } from './program-mail.integration-support';

export function registerProgramMailPendingRecoveryCase(
  currentWorld: () => ProgramMailIntegrationWorld,
): void {
  it('reports stale PENDING as in progress until the worker recovers it', async () => {
    const world = currentWorld();
    const principal = await world.principal(DIGEST_FIXTURE.staffOnGithub);
    const runtime = world.createRuntime(world.mailSender);
    const recipients = await runtime.service.recipients(
      DIGEST_FIXTURE.notifyProgram,
      DIGEST_FIXTURE.now,
    );
    const applicant = recipients.teams
      .flatMap((team) => team.applicants)
      .find((candidate) => candidate.mailAvailable);
    if (applicant === undefined)
      throw new Error('Missing mail recipient fixture');
    const draft = {
      subject: 'pending recovery',
      body: '본문',
      applicantIds: [applicant.id],
    };
    const preview = await runtime.service.preview(
      DIGEST_FIXTURE.notifyProgram,
      principal,
      draft,
      DIGEST_FIXTURE.now,
    );
    const audience = await world.findAudience({
      from: new Date(DIGEST_FIXTURE.now.getTime() - 1),
      to: new Date(DIGEST_FIXTURE.now.getTime() + 1),
    });
    const selected = audience?.teams
      .flatMap((team) => team.applicants)
      .find((candidate) => candidate.id === applicant.id);
    if (
      audience === null ||
      selected === undefined ||
      selected.notificationEmail === null
    ) {
      throw new Error('Missing deliverable mail recipient fixture');
    }
    const reservation = await new ProgramMailSendRepository(
      world.prisma,
      new ProgramMailAuditRepository(),
      new ProgramMailKeyRepository(),
    ).reserve({
      actorId: principal.id,
      programId: audience.id,
      programName: audience.name,
      senderName: preview.senderName,
      recipients: [
        {
          id: selected.id,
          displayName: selected.displayName,
          notificationEmail: selected.notificationEmail,
        },
      ],
      subject: draft.subject,
      body: draft.body,
      bodyHash: createHash('sha256').update(draft.body).digest('hex'),
      bodyLength: draft.body.length,
      previewVersion: preview.previewVersion,
      occurredAt: DIGEST_FIXTURE.now,
    });
    expect(reservation).toMatchObject({ kind: 'OWNER' });

    const request = {
      ...draft,
      previewedAt: preview.previewedAt,
      previewVersion: preview.previewVersion,
    };
    await expect(
      runtime.service.send(
        DIGEST_FIXTURE.notifyProgram,
        principal,
        request,
        DIGEST_FIXTURE.now,
      ),
    ).resolves.toMatchObject({ status: 'IN_PROGRESS', sentCount: 0 });
    expect(world.mailSender.sent).toHaveLength(0);

    await expect(
      runtime.worker.process(
        `program-mail-send:${preview.previewVersion}`,
        () => DIGEST_FIXTURE.now,
      ),
    ).resolves.toMatchObject({
      kind: 'COMPLETED',
      result: {
        sentCount: 1,
        duplicateCount: 0,
        failedCount: 0,
        unknownCount: 0,
      },
    });
    expect(world.mailSender.sent).toHaveLength(1);
    await expect(
      runtime.service.send(
        DIGEST_FIXTURE.notifyProgram,
        principal,
        request,
        DIGEST_FIXTURE.now,
      ),
    ).resolves.toMatchObject({ status: 'COMPLETED', sentCount: 1 });
  });
}
