import type { ProgramActivitySummaryRepository } from './program-activity-summary.repository';
import { ProgramActivitySummaryService } from './program-activity-summary.service';

describe('ProgramActivitySummaryService', () => {
  it('aggregates canonical repository activity for every requested program', async () => {
    // Given
    const findRepositoryLinks = jest.fn().mockResolvedValue([
      { programId: 'program-1', githubRepositoryId: 101n },
      { programId: 'program-1', githubRepositoryId: 102n },
      { programId: 'program-2', githubRepositoryId: 201n },
    ]);
    const findCanonicalActivity = jest.fn().mockResolvedValue([
      {
        githubRepositoryId: 101n,
        commitCount: 2,
        pullRequestCount: 1,
        releaseCount: 0,
        lastActivityAt: new Date('2026-07-22T00:00:00.000Z'),
        dataAsOf: new Date('2026-07-25T00:00:00.000Z'),
      },
      {
        githubRepositoryId: 102n,
        commitCount: 1,
        pullRequestCount: 0,
        releaseCount: 1,
        lastActivityAt: new Date('2026-07-23T00:00:00.000Z'),
        dataAsOf: new Date('2026-07-26T00:00:00.000Z'),
      },
    ]);
    const repository = {
      findRepositoryLinks,
      findCanonicalActivity,
    } satisfies Pick<
      ProgramActivitySummaryRepository,
      'findRepositoryLinks' | 'findCanonicalActivity'
    >;

    // When
    const result = await new ProgramActivitySummaryService(
      repository,
    ).summarize(['program-1', 'program-2', 'program-empty']);

    // Then
    expect(result).toEqual([
      {
        programId: 'program-1',
        repositoryCount: 2,
        commitCount: 3,
        pullRequestCount: 1,
        releaseCount: 1,
        lastActivityAt: '2026-07-23T00:00:00.000Z',
        dataAsOf: '2026-07-26T00:00:00.000Z',
      },
      {
        programId: 'program-2',
        repositoryCount: 1,
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
        lastActivityAt: null,
        dataAsOf: null,
      },
      {
        programId: 'program-empty',
        repositoryCount: 0,
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
        lastActivityAt: null,
        dataAsOf: null,
      },
    ]);
    expect(findRepositoryLinks).toHaveBeenCalledWith([
      'program-1',
      'program-2',
      'program-empty',
    ]);
    expect(findCanonicalActivity).toHaveBeenCalledWith([101n, 102n, 201n]);
  });

  it('keeps repository count and canonical activity aligned for a linked repository', async () => {
    // Given
    const findRepositoryLinks = jest
      .fn()
      .mockResolvedValue([
        { programId: 'program-archived', githubRepositoryId: 301n },
      ]);
    const findCanonicalActivity = jest.fn().mockResolvedValue([
      {
        githubRepositoryId: 301n,
        commitCount: 4,
        pullRequestCount: 2,
        releaseCount: 1,
        lastActivityAt: new Date('2026-07-24T00:00:00.000Z'),
        dataAsOf: new Date('2026-07-27T00:00:00.000Z'),
      },
    ]);
    const repository = {
      findRepositoryLinks,
      findCanonicalActivity,
    } satisfies Pick<
      ProgramActivitySummaryRepository,
      'findRepositoryLinks' | 'findCanonicalActivity'
    >;

    // When
    const result = await new ProgramActivitySummaryService(
      repository,
    ).summarize(['program-archived']);

    // Then
    expect(result).toEqual([
      {
        programId: 'program-archived',
        repositoryCount: 1,
        commitCount: 4,
        pullRequestCount: 2,
        releaseCount: 1,
        lastActivityAt: '2026-07-24T00:00:00.000Z',
        dataAsOf: '2026-07-27T00:00:00.000Z',
      },
    ]);
  });

  it('skips repository reads when there are no programs', async () => {
    // Given
    const findRepositoryLinks = jest.fn();
    const findCanonicalActivity = jest.fn();
    const repository = {
      findRepositoryLinks,
      findCanonicalActivity,
    } satisfies Pick<
      ProgramActivitySummaryRepository,
      'findRepositoryLinks' | 'findCanonicalActivity'
    >;

    // When
    const result = await new ProgramActivitySummaryService(
      repository,
    ).summarize([]);

    // Then
    expect(result).toEqual([]);
    expect(findRepositoryLinks).not.toHaveBeenCalled();
    expect(findCanonicalActivity).not.toHaveBeenCalled();
  });
});
