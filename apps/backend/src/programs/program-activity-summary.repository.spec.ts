import {
  type ProgramActivitySummaryDataSource,
  ProgramActivitySummaryRepository,
} from './program-activity-summary.repository';

describe('ProgramActivitySummaryRepository', () => {
  it('uses completed canonical history even when a linked repository is archived', async () => {
    let queryText = '';
    const prisma = {
      repository: { findMany: jest.fn() },
      $queryRaw: <T>(query: unknown): Promise<T> => {
        queryText = sqlText(query);
        return Promise.resolve([
          {
            githubRepositoryId: 101n,
            commitCount: 2n,
            pullRequestCount: 1n,
            releaseCount: 0n,
            lastActivityAt: new Date('2026-07-22T00:00:00.000Z'),
            dataAsOf: new Date('2026-07-25T00:00:00.000Z'),
          },
        ] as T);
      },
    } satisfies ProgramActivitySummaryDataSource;

    const result = await new ProgramActivitySummaryRepository(
      prisma,
    ).findCanonicalActivity([101n]);

    expect(queryText).toContain('generation."finishedAt" AS "dataAsOf"');
    expect(queryText).toContain('generation."finishedAt" IS NOT NULL');
    expect(queryText).not.toContain('repository."archived" = false');
    expect(queryText).not.toContain('state."updatedAt" AS "dataAsOf"');
    expect(result).toEqual([
      {
        githubRepositoryId: 101n,
        commitCount: 2,
        pullRequestCount: 1,
        releaseCount: 0,
        lastActivityAt: new Date('2026-07-22T00:00:00.000Z'),
        dataAsOf: new Date('2026-07-25T00:00:00.000Z'),
      },
    ]);
  });

  it('skips canonical reads when no repository is linked', async () => {
    const queryRaw = jest.fn();
    const prisma = {
      repository: { findMany: jest.fn() },
      $queryRaw: queryRaw,
    } satisfies ProgramActivitySummaryDataSource;

    await expect(
      new ProgramActivitySummaryRepository(prisma).findCanonicalActivity([]),
    ).resolves.toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

function sqlText(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const strings: unknown = Reflect.get(value, 'strings');
    if (Array.isArray(strings)) return strings.join('');
  }
  return String(value);
}
