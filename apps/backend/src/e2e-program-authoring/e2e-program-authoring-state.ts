import { SubmissionFileLifecycle } from '@prisma/client';
import type { E2eExternalCapture } from './e2e-external-port-registry';
import type {
  E2eProgramAuthoringGraph,
  E2eProgramAuthoringState,
} from './e2e-program-authoring.types';
import { PrismaService } from '../prisma/prisma.service';

export async function stateForE2eProgramGraph(
  prisma: PrismaService,
  graph: E2eProgramAuthoringGraph,
  capture: E2eExternalCapture,
  actorIds: readonly string[],
): Promise<E2eProgramAuthoringState> {
  const [
    programs,
    milestones,
    documents,
    applications,
    teams,
    repositoryJobs,
    repositories,
    notifications,
    templateFiles,
    attachedSubmissionFileKeys,
    pendingUploads,
    pendingSubmissionFiles,
    attachedAuthoringUploadKeys,
  ] = await Promise.all([
    prisma.program.count({ where: { id: graph.programId } }),
    prisma.milestone.count({ where: { programId: graph.programId } }),
    prisma.milestoneDocument.count({
      where: { milestone: { programId: graph.programId } },
    }),
    prisma.application.count({ where: { programId: graph.programId } }),
    prisma.team.count({ where: { programId: graph.programId } }),
    prisma.repositoryProvisionJob.count({
      where: { application: { programId: graph.programId } },
    }),
    prisma.githubRepository.count({
      where: { application: { programId: graph.programId } },
    }),
    prisma.notification.count({ where: { userId: { in: [...actorIds] } } }),
    prisma.milestoneDocumentTemplateFile.findMany({
      where: {
        milestoneDocument: { milestone: { programId: graph.programId } },
      },
      select: { storageKey: true },
    }),
    prisma.submissionFile.findMany({
      where: {
        application: { programId: graph.programId },
        lifecycle: SubmissionFileLifecycle.ATTACHED,
      },
      select: { storageKey: true },
    }),
    prisma.programAuthoringUpload.count({
      where: {
        actorId: actorIds[0],
        lifecycle: { in: ['PENDING', 'DELETE_PENDING'] },
      },
    }),
    prisma.submissionFile.count({
      where: {
        application: { programId: graph.programId },
        lifecycle: { in: ['PENDING', 'DELETE_PENDING'] },
      },
    }),
    prisma.programAuthoringUpload.findMany({
      where: {
        createRequest: { programId: graph.programId },
        lifecycle: 'ATTACHED',
      },
      select: { storageKey: true },
    }),
  ]);
  const attachedObjectKeys = new Set([
    ...templateFiles.map(({ storageKey }) => storageKey),
    ...attachedSubmissionFileKeys.map(({ storageKey }) => storageKey),
    ...attachedAuthoringUploadKeys.map(({ storageKey }) => storageKey),
  ]);
  const capturedObjectKeys = new Set(capture.storage.objectKeys);
  let orphanObjects = 0;
  for (const objectKey of attachedObjectKeys) {
    if (!capturedObjectKeys.has(objectKey)) orphanObjects += 1;
  }
  for (const objectKey of capturedObjectKeys) {
    if (!attachedObjectKeys.has(objectKey)) orphanObjects += 1;
  }
  return {
    programs,
    milestones,
    documents,
    applications,
    teams,
    repositoryJobs,
    repositories,
    notifications,
    dryRunEnvelopes: capture.mail.envelopeCount,
    attachedFiles: attachedObjectKeys.size,
    orphanRows: pendingUploads + pendingSubmissionFiles,
    orphanObjects,
    mailContentHashes: capture.mail.contentHashes,
    storageContentHashes: capture.storage.contentHashes,
  };
}
