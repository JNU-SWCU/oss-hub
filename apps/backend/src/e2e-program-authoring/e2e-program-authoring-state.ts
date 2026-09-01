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
    // 스토리지 기록(capture)은 프로세스 전역이라 DB 쪽도 같은 범위여야 한다 — 작성 업로드는
    // 프로그램이 아니라 actor가 소유하므로, prisma 장애 케이스처럼 재시도가 새 프로그램을 만들고
    // 거기에 업로드를 첨부하면 createRequest 범위로는 잡히지 않아 가짜 고아가 된다. actor 범위는
    // fixture reset이 이 표를 비우는 범위이자 바로 위 미첨부 업로드 집계의 범위와 같다.
    prisma.programAuthoringUpload.findMany({
      where: { actorId: actorIds[0], lifecycle: 'ATTACHED' },
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
