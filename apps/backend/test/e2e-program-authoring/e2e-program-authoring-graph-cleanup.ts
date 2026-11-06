import type { E2eProgramAuthoringGraph } from './e2e-program-authoring.types';
import { PrismaService } from '../../src/platform/prisma.service';

export async function removeAdoptedGraph(
  prisma: PrismaService,
  graph: E2eProgramAuthoringGraph,
  prefix: string,
  deleteStorageObject: (storageKey: string) => Promise<void> = () =>
    Promise.resolve(),
): Promise<void> {
  const uploads = await prisma.file.findMany({
    where: { kind: 'UPLOAD', programId: graph.programId },
    select: { storageKey: true },
  });
  const templateFiles = await prisma.file.findMany({
    where: {
      kind: 'TEMPLATE',
      requirement: { milestone: { programId: graph.programId } },
    },
    select: { storageKey: true },
  });
  const covers = await prisma.$transaction(async (transaction) => {
    const program = await transaction.program.findFirst({
      where: { id: graph.programId, name: { startsWith: prefix } },
      select: { id: true },
    });
    if (program === null) return [];
    const covers = await transaction.file.findMany({
      where: { kind: 'COVER', programId: graph.programId },
      select: { storageKey: true },
    });
    const applications = await transaction.team.findMany({
      where: { programId: graph.programId },
      select: { id: true },
    });
    const teamIds = applications.map((application) => application.id);
    const documentSubmissions = await transaction.submission.findMany({
      where: { teamId: { in: teamIds } },
      select: { id: true },
    });
    const documentSubmissionIds = documentSubmissions.map(
      (submission) => submission.id,
    );
    const documentSubmissionHistories =
      await transaction.submissionHistory.findMany({
        where: {
          submissionId: { in: documentSubmissionIds },
        },
        select: { id: true },
      });
    const documentSubmissionHistoryIds = documentSubmissionHistories.map(
      (history) => history.id,
    );
    await transaction.outboxEvent.deleteMany({
      where: { aggregateId: { in: teamIds } },
    });
    await transaction.repositoryProvisionJob.deleteMany({
      where: { teamId: { in: teamIds } },
    });
    await transaction.repositoryInvitation.deleteMany({
      where: { repository: { teamId: { in: teamIds } } },
    });
    await transaction.githubRepository.deleteMany({
      where: { teamId: { in: teamIds } },
    });
    await transaction.file.deleteMany({
      where: {
        kind: 'SUBMISSION',
        OR: [
          { teamId: { in: teamIds } },
          { kind: 'SUBMISSION', submissionId: { in: documentSubmissionIds } },
          {
            kind: 'SUBMISSION',
            submissionHistoryId: {
              in: documentSubmissionHistoryIds,
            },
          },
        ],
      },
    });
    await transaction.submissionHistory.deleteMany({
      where: { id: { in: documentSubmissionHistoryIds } },
    });
    await transaction.submission.deleteMany({
      where: { id: { in: documentSubmissionIds } },
    });
    await transaction.teamMember.deleteMany({
      where: { teamId: { in: teamIds } },
    });
    await transaction.team.deleteMany({ where: { id: { in: teamIds } } });
    await transaction.file.deleteMany({
      where: {
        kind: 'TEMPLATE',
        requirement: { milestone: { programId: graph.programId } },
      },
    });
    await transaction.requirement.deleteMany({
      where: { milestone: { programId: graph.programId } },
    });
    await transaction.milestone.deleteMany({
      where: { programId: graph.programId },
    });
    await transaction.file.deleteMany({
      where: { kind: 'UPLOAD', programId: graph.programId },
    });
    await transaction.file.deleteMany({
      where: { kind: 'COVER', programId: graph.programId },
    });
    await transaction.program.delete({ where: { id: graph.programId } });
    return covers;
  });
  const storageKeys = new Set(
    [...uploads, ...templateFiles, ...covers].flatMap(({ storageKey }) =>
      storageKey === null ? [] : [storageKey],
    ),
  );
  for (const storageKey of storageKeys) {
    await deleteStorageObject(storageKey);
  }
}
