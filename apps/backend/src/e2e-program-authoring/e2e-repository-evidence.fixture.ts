import type { PrismaService } from '../prisma/prisma.service';
import { E2eAdapterError } from './e2e-program-authoring.adapter-error';
import type { E2eProgramAuthoringGraph } from './e2e-program-authoring.types';
import {
  E2E_PROGRAM_ID,
  E2E_STUDENT_ID,
  E2E_STUDENT_GITHUB_ID,
} from './e2e-program-authoring-fixture';

export interface E2eRepositoryEvidence {
  readonly currentRepositoryId: string;
  readonly facts: readonly {
    readonly repositoryId: string;
    readonly githubId: string;
    readonly date: string;
    readonly commitCount: number;
    readonly pullRequestCount: number;
    readonly releaseCount: number;
  }[];
}

export async function seedE2eRepositoryEvidence(
  prisma: PrismaService,
  graph: E2eProgramAuthoringGraph,
): Promise<E2eRepositoryEvidence> {
  if (graph.programId !== E2E_PROGRAM_ID) throw new E2eAdapterError(409);
  return prisma.$transaction(async (transaction) => {
    const application = await transaction.application.findFirst({
      where: {
        programId: E2E_PROGRAM_ID,
        applicantId: E2E_STUDENT_ID,
        status: 'APPROVED',
      },
      select: {
        repository: { select: { id: true, programId: true } },
        program: { select: { startAt: true, endAt: true } },
      },
    });
    if (
      !application?.repository ||
      application.repository.programId !== E2E_PROGRAM_ID
    ) {
      throw new E2eAdapterError(409);
    }
    const currentRepositoryId = application.repository.id;
    const date = new Date(
      application.program.startAt.getTime() + 24 * 60 * 60 * 1000,
    );
    date.setUTCHours(0, 0, 0, 0);
    if (date > application.program.endAt) throw new E2eAdapterError(409);
    for (const observation of [
      {
        githubId: E2E_STUDENT_GITHUB_ID,
        commitCount: 7,
        pullRequestCount: 2,
        releaseCount: 1,
      },
      {
        githubId: 8_199_999n,
        commitCount: 5,
        pullRequestCount: 1,
        releaseCount: 0,
      },
    ]) {
      await transaction.contribution.upsert({
        where: {
          repositoryId_githubId_date: {
            repositoryId: currentRepositoryId,
            githubId: observation.githubId,
            date,
          },
        },
        create: { repositoryId: currentRepositoryId, date, ...observation },
        update: observation,
      });
    }
    await transaction.githubRepository.update({
      where: { id: currentRepositoryId },
      data: { lastSuccessAt: new Date(), failureCount: 0 },
    });
    const facts = await transaction.contribution.findMany({
      where: { repository: { programId: E2E_PROGRAM_ID } },
      select: {
        repositoryId: true,
        githubId: true,
        date: true,
        commitCount: true,
        pullRequestCount: true,
        releaseCount: true,
      },
      orderBy: [{ repositoryId: 'asc' }, { githubId: 'asc' }, { date: 'asc' }],
    });
    return {
      currentRepositoryId,
      facts: facts.map((fact) => ({
        ...fact,
        githubId: fact.githubId.toString(),
        date: fact.date.toISOString(),
      })),
    };
  });
}
