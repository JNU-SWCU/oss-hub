import type { E2eProgramAuthoringGraph } from './e2e-program-authoring.types';
import { PrismaService } from '../prisma/prisma.service';

export async function removeAdoptedGraph(
  prisma: PrismaService,
  graph: E2eProgramAuthoringGraph,
  prefix: string,
  deleteStorageObject: (storageKey: string) => Promise<void> = () =>
    Promise.resolve(),
): Promise<void> {
  const uploads = await prisma.programAuthoringUpload.findMany({
    where: { createRequest: { programId: graph.programId } },
    select: { storageKey: true },
  });
  const templateFiles = await prisma.milestoneDocumentTemplateFile.findMany({
    where: {
      milestoneDocument: { milestone: { programId: graph.programId } },
    },
    select: { storageKey: true },
  });
  await prisma.$transaction(async (transaction) => {
    const program = await transaction.program.findFirst({
      where: { id: graph.programId, name: { startsWith: prefix } },
      select: { id: true },
    });
    if (program === null) return;
    const applications = await transaction.application.findMany({
      where: { programId: graph.programId },
      select: { id: true, teamId: true },
    });
    const applicationIds = applications.map((application) => application.id);
    const teamIds = applications.map((application) => application.teamId);
    const documentSubmissions =
      await transaction.milestoneDocumentSubmission.findMany({
        where: { applicationId: { in: applicationIds } },
        select: { id: true },
      });
    const documentSubmissionIds = documentSubmissions.map(
      (submission) => submission.id,
    );
    const documentSubmissionHistories =
      await transaction.milestoneDocumentSubmissionHistory.findMany({
        where: {
          milestoneDocumentSubmissionId: { in: documentSubmissionIds },
        },
        select: { id: true },
      });
    const documentSubmissionHistoryIds = documentSubmissionHistories.map(
      (history) => history.id,
    );
    await transaction.outboxEvent.deleteMany({
      where: { aggregateId: { in: applicationIds } },
    });
    await transaction.repositoryProvisionJob.deleteMany({
      where: { applicationId: { in: applicationIds } },
    });
    await transaction.repositoryInvitation.deleteMany({
      where: { repository: { applicationId: { in: applicationIds } } },
    });
    await transaction.githubRepository.deleteMany({
      where: { applicationId: { in: applicationIds } },
    });
    await transaction.milestoneDocumentReviewHistory.deleteMany({
      where: {
        milestoneDocumentSubmissionId: { in: documentSubmissionIds },
      },
    });
    await transaction.submissionFile.deleteMany({
      where: {
        OR: [
          { applicationId: { in: applicationIds } },
          {
            milestoneDocumentSubmissionId: { in: documentSubmissionIds },
          },
          {
            milestoneDocumentSubmissionHistoryId: {
              in: documentSubmissionHistoryIds,
            },
          },
        ],
      },
    });
    await transaction.milestoneDocumentSubmissionHistory.deleteMany({
      where: { id: { in: documentSubmissionHistoryIds } },
    });
    await transaction.milestoneDocumentSubmission.deleteMany({
      where: { id: { in: documentSubmissionIds } },
    });
    await transaction.application.deleteMany({
      where: { id: { in: applicationIds } },
    });
    await transaction.teamMember.deleteMany({
      where: { teamId: { in: teamIds } },
    });
    await transaction.team.deleteMany({ where: { id: { in: teamIds } } });
    await transaction.milestoneDocumentTemplateFile.deleteMany({
      where: {
        milestoneDocument: { milestone: { programId: graph.programId } },
      },
    });
    await transaction.milestoneDocument.deleteMany({
      where: { milestone: { programId: graph.programId } },
    });
    await transaction.milestone.deleteMany({
      where: { programId: graph.programId },
    });
    await transaction.programAuthoringUpload.deleteMany({
      where: { createRequest: { programId: graph.programId } },
    });
    await transaction.programCreateRequest.deleteMany({
      where: { programId: graph.programId },
    });
    await transaction.program.delete({ where: { id: graph.programId } });
  });
  const storageKeys = new Set(
    [...uploads, ...templateFiles].map(({ storageKey }) => storageKey),
  );
  for (const storageKey of storageKeys) {
    await deleteStorageObject(storageKey);
  }
}
