import { MailJobConfig } from './mail-job.config';
import { createOwnedIntegrationDatabase } from '../../test/owned-integration-database.fixture';
import { MailJobAdmissionRepository } from './mail-job-admission.repository';
import { MailJobResultRepository } from './mail-job-result.repository';
import { MailJobWorkerService } from './mail-job-worker.service';
import { MailJobClaimRepository } from './mail-job-claim.repository';
import { ProgramMailJobRepository } from './program-mail-job.repository';
import { ProgramMailBatchPayloadRepository } from './program-mail-batch-payload.repository';
import { SystemStatusRepository } from '../admin/system-status.repository';
import { PlatformRepository } from '../platform/platform.repository';

it('keeps the old daily key, refuses unsafe rollback, and never hands an uncertain recipient to SMTP twice', async () => {
  const db = await createOwnedIntegrationDatabase();
  try {
    const p = db.prisma;
    const programId = 'synthetic-cutover';
    const actorId = 'synthetic-staff';
    const userId = 'synthetic-recipient';
    const now = new Date();
    await p.user.createMany({
      data: [
        { id: actorId, githubId: 90000000001n, nickname: actorId },
        {
          id: userId,
          githubId: 90000000002n,
          nickname: userId,
          notifyEnabled: true,
          notificationEmail: 'recipient@example.invalid',
        },
      ],
    });
    await p.program.create({
      data: {
        id: programId,
        name: programId,
        category: 'BASIC',
        applicationTemplateKey: 'synthetic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date(now.getTime() - 86400000),
        applicationEndAt: now,
        startAt: now,
        endAt: new Date(now.getTime() + 86400000),
        description: '',
      },
    });
    await p.team.create({
      data: {
        name: 'synthetic',
        programId,
        leaderId: userId,
        applicantId: userId,
        answers: {},
        applicationTemplateVersion: 1,
      },
    });
    const oldKey = `deadline-digest:${MailJobConfig.seoulDay(now)}:${programId}:${userId}`;
    await p.notification.create({
      data: {
        userId,
        type: 'DEADLINE_DIGEST',
        channel: 'EMAIL',
        status: 'SENT',
        sentAt: now,
        idempotencyKey: oldKey,
        payload: {},
      },
    });
    const mode = (value: 'LEGACY' | 'JOBS' | 'PAUSED') =>
      p.mailControl.update({ where: { id: 1 }, data: { mode: value } });
    await mode('PAUSED');
    await mode('JOBS');
    await mode('PAUSED');
    await mode('LEGACY');
    await mode('PAUSED');
    await mode('JOBS');
    const jobs = new MailJobAdmissionRepository(p);
    const receipts = new ProgramMailJobRepository(
      p,
      new ProgramMailBatchPayloadRepository(),
    );
    const result = new MailJobResultRepository(p);
    const envelope = {
      to: 'recipient@example.invalid',
      displayName: userId,
      programName: programId,
      subject: 'synthetic',
      body: 'synthetic',
      html: 'synthetic',
    };
    const input = {
      source: 'PROGRAM_MANUAL' as const,
      programId,
      actorId,
      previewVersion: 'synthetic',
      requestDigest: 'synthetic',
    };
    const prepare = () =>
      Promise.resolve({
        deliveries: [{ audience: 'STUDENT' as const, userId, envelope }],
      });
    await jobs.accept({ ...input, source: 'DEADLINE_MANUAL' }, prepare);
    const job = await jobs.accept(input, prepare);
    if (!job) throw new Error('Missing receipt');
    expect(await jobs.accept(input, prepare)).toEqual({
      jobId: job.jobId,
      replay: true,
    });
    expect(
      await p.mailRecipient.count({ where: { state: 'ALREADY_RESERVED' } }),
    ).toBe(1);
    expect(
      await p.notification.count({ where: { idempotencyKey: oldKey } }),
    ).toBe(1);
    await mode('PAUSED');
    await expect(mode('LEGACY')).rejects.toThrow();
    expect(await receipts.status(programId, job.jobId)).toMatchObject({
      status: 'QUEUED',
    });
    await mode('JOBS');
    let calls = 0;
    const worker = new MailJobWorkerService(
      new MailJobClaimRepository(p, result),
      {
        send() {
          calls++;
          return Promise.reject(new Error('connection closed after DATA'));
        },
      },
      {
        prepareJob() {
          return Promise.reject(new Error('Suppressed digest was claimed'));
        },
      },
    );
    for (let i = 0; i < 6 && (await worker.step()); i++) continue;
    await worker.recover();
    expect(await worker.step()).toBe(false);
    expect(calls).toBe(1);
    expect(await receipts.status(programId, job.jobId)).toMatchObject({
      status: 'COMPLETED',
      sentCount: 0,
      failedCount: 0,
      unknownCount: 1,
    });
    expect(
      await p.programHistory.count({
        where: {
          sourceTable: 'MailJob',
          sourceId: { in: [`${job.jobId}:attempt`, `${job.jobId}:result`] },
        },
      }),
    ).toBe(2);
    expect(
      await new SystemStatusRepository(
        p,
        new PlatformRepository(),
      ).getMailStatus(new Date(0)),
    ).toEqual({ sent7d: 1, failed7d: 0, unknown7d: 1, lastSentAt: now });
    await expect(
      p.mailRecipient.updateMany({
        where: { state: 'UNKNOWN' },
        data: { state: 'PENDING' },
      }),
    ).rejects.toThrow();
    const interrupted = await jobs.accept(
      { ...input, previewVersion: 'interrupted' },
      prepare,
    );
    if (!interrupted) throw new Error('Missing interrupted receipt');
    const claimed = await new MailJobClaimRepository(p, result).claim({
      prepareJob: () => Promise.reject(new Error('unexpected digest')),
    });
    expect(claimed?.mail?.to).toBe(envelope.to);
    await worker.recover();
    expect(await worker.step()).toBe(true);
    expect(await worker.step()).toBe(false);
    expect(calls).toBe(1);
    expect(await receipts.status(programId, interrupted.jobId)).toMatchObject({
      status: 'COMPLETED',
      sentCount: 0,
      failedCount: 0,
      unknownCount: 1,
    });
  } finally {
    await db.close();
  }
}, 90000);
