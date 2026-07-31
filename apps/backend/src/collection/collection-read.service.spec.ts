import { CanonicalCollectionRunStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { CollectionCanonicalRepository } from './collection-canonical.repository';
import { CollectionReadService } from './collection-read.service';

const FINISHED_AT = new Date('2026-07-31T03:00:00.000Z');
const ORGANIZATION_UPDATED_AT = new Date('2026-07-31T04:00:00.000Z');

interface RepositoryActivityFixture {
  githubRepositoryId: bigint;
  commits: Array<{ committedAt: Date }>;
  pullRequests: Array<{ createdAt: Date }>;
  releases: Array<{ publishedAt: Date }>;
}

interface OrganizationStateFixture {
  updatedAt: Date;
  activeGeneration: {
    finishedAt: Date | null;
    repositories: RepositoryActivityFixture[];
  } | null;
}

interface RepositoryActivityQuery {
  readonly select: {
    readonly activeGeneration: {
      readonly select: {
        readonly repositories: {
          readonly select: {
            readonly commits: { readonly where: unknown };
            readonly pullRequests: { readonly where: unknown };
            readonly releases: { readonly where: unknown };
          };
        };
      };
    };
  };
}

type FindManyMock = jest.Mock<
  Promise<OrganizationStateFixture[]>,
  [query: RepositoryActivityQuery]
>;

interface MockPrismaClient {
  canonicalOrganizationState: {
    findMany: FindManyMock;
  };
}

const createPrisma = (): MockPrismaClient => ({
  canonicalOrganizationState: {
    findMany: jest.fn<
      Promise<OrganizationStateFixture[]>,
      [query: RepositoryActivityQuery]
    >(),
  },
});

const serviceFor = (db: MockPrismaClient): CollectionReadService => {
  const prisma = db as unknown as PrismaService;
  return new CollectionReadService(
    prisma,
    new CollectionCanonicalRepository(prisma),
  );
};

describe('CollectionReadService repository activity adapter', () => {
  it('returns active generation finishedAt as dataAsOf', async () => {
    const db = createPrisma();
    db.canonicalOrganizationState.findMany.mockResolvedValue([
      {
        updatedAt: ORGANIZATION_UPDATED_AT,
        activeGeneration: {
          finishedAt: FINISHED_AT,
          repositories: [
            {
              githubRepositoryId: 101n,
              commits: [{ committedAt: new Date('2026-07-30T01:00:00Z') }],
              pullRequests: [{ createdAt: new Date('2026-07-30T02:00:00Z') }],
              releases: [{ publishedAt: new Date('2026-07-30T03:00:00Z') }],
            },
          ],
        },
      },
    ]);

    const activity = await serviceFor(db).findRepositoryActivity({
      repositoryIds: [101n],
    });

    expect(activity).toEqual([
      expect.objectContaining({
        repositoryId: 101n,
        dataAsOf: FINISHED_AT,
      }),
    ]);
    expect(activity[0]?.dataAsOf).not.toEqual(ORGANIZATION_UPDATED_AT);
  });

  it('returns no records when the active generation is unfinished', async () => {
    const db = createPrisma();
    db.canonicalOrganizationState.findMany.mockResolvedValue([
      {
        updatedAt: ORGANIZATION_UPDATED_AT,
        activeGeneration: {
          finishedAt: null,
          repositories: [
            {
              githubRepositoryId: 101n,
              commits: [],
              pullRequests: [],
              releases: [],
            },
          ],
        },
      },
    ]);

    const activity = await serviceFor(db).findRepositoryActivity({
      repositoryIds: [101n],
    });

    expect(activity).toEqual([]);
  });

  it('applies repository and optional author filters to every activity relation', async () => {
    const db = createPrisma();
    db.canonicalOrganizationState.findMany.mockResolvedValue([]);

    await serviceFor(db).findRepositoryActivity({
      repositoryIds: [101n, 202n],
      authorGithubId: 303n,
    });

    const repositoryFilter = {
      githubRepositoryId: { in: [101n, 202n] },
    };
    const authorFilter = { authorGithubId: 303n };
    expect(db.canonicalOrganizationState.findMany).toHaveBeenCalledWith({
      where: {
        activeGenerationId: { not: null },
        activeGeneration: {
          status: CanonicalCollectionRunStatus.SUCCEEDED,
          repositories: { some: repositoryFilter },
        },
      },
      select: {
        activeGeneration: {
          select: {
            finishedAt: true,
            repositories: {
              where: repositoryFilter,
              select: {
                githubRepositoryId: true,
                commits: {
                  where: authorFilter,
                  select: { committedAt: true },
                },
                pullRequests: {
                  where: authorFilter,
                  select: { createdAt: true },
                },
                releases: {
                  where: authorFilter,
                  select: { publishedAt: true },
                },
              },
            },
          },
        },
      },
    });
  });

  it('leaves activity relations unfiltered when authorGithubId is omitted', async () => {
    const db = createPrisma();
    db.canonicalOrganizationState.findMany.mockResolvedValue([]);

    await serviceFor(db).findRepositoryActivity({ repositoryIds: [101n] });

    const query = db.canonicalOrganizationState.findMany.mock.calls[0]?.[0];
    const activitySelect =
      query?.select.activeGeneration.select.repositories.select;
    expect(activitySelect?.commits.where).toBeUndefined();
    expect(activitySelect?.pullRequests.where).toBeUndefined();
    expect(activitySelect?.releases.where).toBeUndefined();
  });
});
