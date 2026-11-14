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
        teamRepos: { where: { validTo: null }, select: { repoId: true } },
        program: { select: { startAt: true, endAt: true } },
      },
    });
    const githubRepositoryId = application?.teamRepos[0]?.repoId;
    if (!application || githubRepositoryId === undefined) {
      throw new E2eAdapterError(409);
    }
    const date = new Date(
      application.program.startAt.getTime() + 24 * 60 * 60 * 1000,
    );
    date.setUTCHours(0, 0, 0, 0);
    if (date > application.program.endAt) throw new E2eAdapterError(409);
    const day = date.toISOString().slice(0, 10);
    await seedDailyContributions(
      transaction,
      githubRepositoryId,
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
      githubRepositoryId,
      new Date(),
      'EXTERNAL_PUBLIC',
    );
    const repositories = await transaction.repo.findMany({
      where: E2E_REPOSITORY_WHERE,
      select: { githubRepoId: true },
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
        event.repo_id::text AS "repositoryId",
        event.author_github_id AS "githubId",
        (event.occurred_at AT TIME ZONE 'Asia/Seoul')::date AS "date",
        COUNT(*) FILTER (WHERE event.kind = 'commit')::int AS "commitCount",
        COUNT(*) FILTER (WHERE event.kind = 'pull_request')::int AS "pullRequestCount",
        COUNT(*) FILTER (WHERE event.kind = 'release')::int AS "releaseCount"
      FROM "contribution" AS event
      WHERE event.repo_id = ANY(${repositories.map(
        ({ githubRepoId }) => githubRepoId,
      )})
        AND event.author_github_id IS NOT NULL
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3
    `;
    return {
      currentRepositoryId: githubRepositoryId.toString(),
      facts: facts.map((fact) => ({
        ...fact,
        githubId: fact.githubId.toString(),
        date: fact.date.toISOString(),
      })),
    };
  });
}
