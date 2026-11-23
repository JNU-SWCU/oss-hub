import { DeadlineDigestRepository } from './deadline-digest.repository';
import { DeadlineDigestService } from './deadline-digest.service';
import { DeadlineDigestMailService } from './deadline-digest-mail.service';
import { MailPreviewService } from './mail-preview.service';
import { MailJobAdmissionRepository } from './mail-job-admission.repository';
import { MailJobResultRepository } from './mail-job-result.repository';
import { MailJobWorkerService } from './mail-job-worker.service';
import { MailJobClaimRepository } from './mail-job-claim.repository';
import type { PrismaService } from '../platform/prisma.service';
import type { MailSender } from './gmail-mail.client';
import type { Prisma } from '@prisma/client';

export async function useJobs(db: PrismaService) {
  const current = await db.mailControl.findUniqueOrThrow({
    where: { id: 1 },
    select: { mode: true },
  });
  if (current.mode === 'JOBS') return;
  if (current.mode === 'LEGACY')
    await db.mailControl.update({ where: { id: 1 }, data: { mode: 'PAUSED' } });
  await db.mailControl.update({ where: { id: 1 }, data: { mode: 'JOBS' } });
}
export async function clearFixtureJobs(
  tx: Prisma.TransactionClient,
  programId: string,
) {
  await tx.mailRecipient.deleteMany({ where: { job: { programId } } });
  await tx.mailJob.deleteMany({ where: { programId, partNo: { gt: 0 } } });
  await tx.mailJob.deleteMany({ where: { programId, partNo: 0 } });
}
export function digestRuntime(
  db: PrismaService,
  sender: MailSender,
  anchor: Date,
) {
  let at = anchor;
  const jobs = new MailJobAdmissionRepository(db),
    results = new MailJobResultRepository(db);
  const service = new DeadlineDigestService(
    new DeadlineDigestRepository(db),
    {
      accept: (intent, prepare) => jobs.accept(intent, (tx) => prepare(tx, at)),
    },
    { FRONTEND_URL: 'https://oss.example' },
    new DeadlineDigestMailService(),
    new MailPreviewService(),
    results,
  );
  const worker = new MailJobWorkerService(
    new MailJobClaimRepository(db, results),
    sender,
    {
      prepareJob: (id, _now, anchor, guidance, manual, tx) =>
        service.prepareJob(id, at, anchor, guidance, manual, tx),
    },
  );
  async function drain() {
    while (await worker.step()) continue;
  }
  return {
    worker,
    drain,
    accept: service.accept.bind(service),
    previewProgram: service.previewProgram.bind(service),
    buildDeadlineEligibility: service.buildDeadlineEligibility.bind(service),
    async sendProgramFromPreview(
      id: string,
      request: Parameters<typeof service.accept>[1],
      actor: string,
      now = anchor,
    ) {
      at = now;
      const job = await service.accept(id, request, actor, true);
      await drain();
      return results.legacyDigest(
        id,
        job.jobId,
        job.replay,
        request.previewVersion,
      );
    },
    async sendDeadlineDigests(now = anchor) {
      at = now;
      await service.sendDeadlineDigests(now);
      await drain();
    },
  };
}
