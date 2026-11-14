import type { PrismaService } from '../../src/platform/prisma.service';
import { E2eAdapterError } from './e2e-program-authoring.adapter-error';
import type { E2eProgramAuthoringGraph } from './e2e-program-authoring.types';
import {
  E2E_PROGRAM_ID,
  E2E_REPOSITORY_WHERE,
  E2E_STUDENT_ID,
  E2E_STUDENT_GITHUB_ID,
} from './e2e-program-authoring-fixture';
import {
  seedDailyContributions,
  setRepoLastSuccessAt,
} from '../ledger-contribution.fixture';

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
    await setRepoLastSuccessAt(
      transaction,
      application.repository.githubRepositoryId,
      new Date(),
      'EXTERNAL_PUBLIC',
    );
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
        repository.id AS "repositoryId",
        event.author_github_id AS "githubId",
        (event.occurred_at AT TIME ZONE 'Asia/Seoul')::date AS "date",
        COUNT(*) FILTER (WHERE event.kind = 'commit')::int AS "commitCount",
        COUNT(*) FILTER (WHERE event.kind = 'pull_request')::int AS "pullRequestCount",
        COUNT(*) FILTER (WHERE event.kind = 'release')::int AS "releaseCount"
      FROM "contribution" AS event
      JOIN "GithubRepository" AS repository
        ON repository."githubRepositoryId" = event.repo_id
      WHERE repository.id = ANY(${repositories.map(({ id }) => id)})
        AND event.author_github_id IS NOT NULL
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3
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
