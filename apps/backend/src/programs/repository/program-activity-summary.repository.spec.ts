import {
  type ProgramActivitySummaryDataSource,
  ProgramActivitySummaryRepository,
} from './program-activity-summary.repository';

describe('ProgramActivitySummaryRepository', () => {
  it('returns linked repositories without applying an archived filter', async () => {
    // Given
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { programId: 'program-archived', githubRepositoryId: 101n },
      ]);
    const prisma = {
      githubRepository: { findMany },
    } satisfies ProgramActivitySummaryDataSource;

    // When
    const result = await new ProgramActivitySummaryRepository(
      prisma,
    ).findRepositoryLinks(['program-archived']);

    // Then
    expect(findMany).toHaveBeenCalledWith({
      where: { programId: { in: ['program-archived'] } },
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
    // Given
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
