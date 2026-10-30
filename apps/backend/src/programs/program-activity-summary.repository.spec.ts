import {
  type ProgramActivitySummaryDataSource,
  ProgramActivitySummaryRepository,
} from './program-activity-summary.repository';

describe('ProgramActivitySummaryRepository', () => {
  it('returns currently linked repositories without applying an archived filter', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { programId: 'program-archived', githubRepositoryId: 101n },
      ]);
    const prisma = {
      githubRepository: { findMany },
    } satisfies ProgramActivitySummaryDataSource;

    const result = await new ProgramActivitySummaryRepository(
      prisma,
    ).findRepositoryLinks(['program-archived']);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        programId: { in: ['program-archived'] },
        applicationId: { not: null },
      },
      select: { programId: true, githubRepositoryId: true },
    });
    expect(result).toEqual([
      {
        programId: 'program-archived',
        githubRepositoryId: 101n,
      },
    ]);
  });

  it('skips repository reads when no program is requested', async () => {
    const findMany = jest.fn();
    const prisma = {
      githubRepository: { findMany },
    } satisfies ProgramActivitySummaryDataSource;

    await expect(
      new ProgramActivitySummaryRepository(prisma).findRepositoryLinks([]),
    ).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
