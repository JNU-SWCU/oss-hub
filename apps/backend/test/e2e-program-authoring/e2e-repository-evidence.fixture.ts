import type { PrismaService } from '../../src/platform/prisma.service';
import { E2eAdapterError } from './e2e-program-authoring.adapter-error';
import type { E2eProgramAuthoringGraph } from './e2e-program-authoring.types';
import {
  E2E_PROGRAM_ID,
  E2E_REPOSITORY_WHERE,
  E2E_STUDENT_ID,
  E2E_STUDENT_GITHUB_ID,
} from './e2e-program-authoring-fixture';
import { seedDailyContributions } from '../ledger-contribution.fixture';

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
    const application = await transaction.team.findFirst({
      where: {
        programId: E2E_PROGRAM_ID,
        applicantId: E2E_STUDENT_ID,
        status: 'APPROVED',
      },
      select: {
        repository: { select: { id: true, githubRepositoryId: true } },
        program: { select: { startAt: true, endAt: true } },
      },
    });
    if (!application?.repository) {
      throw new E2eAdapterError(409);
    }
    const currentRepositoryId = application.repository.id;
    const date = new Date(
      application.program.startAt.getTime() + 24 * 60 * 60 * 1000,
    );
    date.setUTCHours(0, 0, 0, 0);
    if (date > application.program.endAt) throw new E2eAdapterError(409);
    const day = date.toISOString().slice(0, 10);
    await seedDailyContributions(
      transaction,
      application.repository.githubRepositoryId,
      [
        {
          githubId: E2E_STUDENT_GITHUB_ID,
          date: day,
          commitCount: 7,
          pullRequestCount: 2,
          releaseCount: 1,
        },
        {
          githubId: 8_199_999n,
          date: day,
          commitCount: 5,
          pullRequestCount: 1,
          releaseCount: 0,
        },
      ],
      'EXTERNAL_PUBLIC',
    );
    await transaction.githubRepository.update({
      where: { id: currentRepositoryId },
      data: { lastSuccessAt: new Date(), failureCount: 0 },
    });
    const repositories = await transaction.githubRepository.findMany({
      where: E2E_REPOSITORY_WHERE,
      select: { id: true },
    });
    const facts = await transaction.$queryRaw<
      Array<{
        repositoryId: string;
        githubId: bigint;
        date: Date;
        commitCount: number;
        pullRequestCount: number;
        releaseCount: number;
      }>
    >`
      SELECT
        repository_id AS "repositoryId",
        github_id AS "githubId",
        activity_date AS "date",
        commit_count AS "commitCount",
        pull_request_count AS "pullRequestCount",
        release_count AS "releaseCount"
      FROM repo_contribution
      WHERE repository_id = ANY(${repositories.map(({ id }) => id)})
      ORDER BY repository_id, github_id, activity_date
    `;
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
