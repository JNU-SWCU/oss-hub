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
    templates,
    attachedSubmissionFiles,
    pendingUploads,
    pendingSubmissionFiles,
    attachedAuthoringUploads,
  ] = await Promise.all([
    prisma.program.count({ where: { id: graph.programId } }),
    prisma.milestone.count({ where: { programId: graph.programId } }),
    prisma.milestoneDocument.count({
      where: { milestoneId: graph.milestoneId },
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
    prisma.milestoneDocumentTemplateFile.count({
      where: { milestoneDocumentId: graph.documentId },
    }),
    prisma.submissionFile.count({
      where: {
        application: { programId: graph.programId },
        lifecycle: SubmissionFileLifecycle.ATTACHED,
      },
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
    prisma.programAuthoringUpload.count({
      where: { actorId: actorIds[0], lifecycle: 'ATTACHED' },
    }),
  ]);
  const attachedFiles =
    templates + attachedSubmissionFiles + attachedAuthoringUploads;
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
    attachedFiles,
    orphanRows: pendingUploads + pendingSubmissionFiles,
    orphanObjects: Math.max(capture.storage.objectCount - attachedFiles, 0),
    mailContentHashes: capture.mail.contentHashes,
    storageContentHashes: capture.storage.contentHashes,
  };
}
