import type { CollectionReadPort } from '../collection/collection-read.port';
import type { ProgramActivitySummaryPort } from './program-activity-summary.port';
import type {
  ProgramActivitySummaryRepository,
  ProgramRepositoryLink,
} from './program-activity-summary.repository';
import { ProgramActivitySummaryService } from './program-activity-summary.service';

describe('ProgramActivitySummaryService', () => {
  it('aggregates collection authority activity for every requested program', async () => {
    // Given
    const findRepositoryLinks = jest.fn().mockResolvedValue([
      { programId: 'program-1', githubRepositoryId: 101n },
      { programId: 'program-1', githubRepositoryId: 102n },
      { programId: 'program-2', githubRepositoryId: 201n },
    ] satisfies readonly ProgramRepositoryLink[]);
    const findRepositoryActivity = jest.fn().mockResolvedValue([
      {
        repositoryId: 101n,
        dataAsOf: new Date('2026-07-25T00:00:00.000Z'),
        commitDates: [
          new Date('2026-07-21T00:00:00.000Z'),
          new Date('2026-07-22T00:00:00.000Z'),
        ],
        pullRequestDates: [new Date('2026-07-20T00:00:00.000Z')],
        releaseDates: [],
      },
      {
        repositoryId: 102n,
        dataAsOf: new Date('2026-07-26T00:00:00.000Z'),
        commitDates: [new Date('2026-07-19T00:00:00.000Z')],
        pullRequestDates: [],
        releaseDates: [new Date('2026-07-23T00:00:00.000Z')],
      },
    ]);
    const repository = {
      findRepositoryLinks,
    } satisfies Pick<ProgramActivitySummaryRepository, 'findRepositoryLinks'>;
    const collection = {
      findRepositoryActivity,
    } satisfies Pick<CollectionReadPort, 'findRepositoryActivity'>;

    // When
    const result = await new ProgramActivitySummaryService(
      repository,
      collection,
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
    expect(findRepositoryActivity).toHaveBeenCalledWith({
      repositoryIds: [101n, 102n, 201n],
    });
  });

  it('uses collection authority for linked archived repository summaries', async () => {
    // Given
    const findRepositoryLinks = jest
      .fn()
      .mockResolvedValue([
        { programId: 'program-archived', githubRepositoryId: 301n },
      ] satisfies readonly ProgramRepositoryLink[]);
    const findRepositoryActivity = jest.fn().mockResolvedValue([
      {
        repositoryId: 301n,
        dataAsOf: new Date('2026-07-27T00:00:00.000Z'),
        commitDates: [
          new Date('2026-07-21T00:00:00.000Z'),
          new Date('2026-07-22T00:00:00.000Z'),
          new Date('2026-07-23T00:00:00.000Z'),
          new Date('2026-07-24T00:00:00.000Z'),
        ],
        pullRequestDates: [
          new Date('2026-07-19T00:00:00.000Z'),
          new Date('2026-07-20T00:00:00.000Z'),
        ],
        releaseDates: [new Date('2026-07-18T00:00:00.000Z')],
      },
    ]);
    const repository = {
      findRepositoryLinks,
    } satisfies Pick<ProgramActivitySummaryRepository, 'findRepositoryLinks'>;
    const collection = {
      findRepositoryActivity,
    } satisfies Pick<CollectionReadPort, 'findRepositoryActivity'>;

    // When
    const result = await new ProgramActivitySummaryService(
      repository,
      collection,
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
    expect(findRepositoryActivity).toHaveBeenCalledWith({
      repositoryIds: [301n],
    });
  });

  it('uses the same latest collection record as program activity detail', async () => {
    // Given
    const findRepositoryLinks = jest
      .fn()
      .mockResolvedValue([
        { programId: 'program-1', githubRepositoryId: 101n },
      ]);
    const findRepositoryActivity = jest.fn().mockResolvedValue([
      {
        repositoryId: 101n,
        dataAsOf: new Date('2026-07-20T00:00:00.000Z'),
        commitDates: [new Date('2026-07-19T00:00:00.000Z')],
        pullRequestDates: [],
        releaseDates: [],
      },
      {
        repositoryId: 101n,
        dataAsOf: new Date('2026-07-27T00:00:00.000Z'),
        commitDates: [],
        pullRequestDates: [new Date('2026-07-25T00:00:00.000Z')],
        releaseDates: [new Date('2026-07-26T00:00:00.000Z')],
      },
    ]);
    const service: ProgramActivitySummaryPort =
      new ProgramActivitySummaryService(
        { findRepositoryLinks },
        { findRepositoryActivity },
      );

    // When
    const result = await service.summarize(['program-1']);

    // Then
    expect(result).toEqual([
      {
        programId: 'program-1',
        repositoryCount: 1,
        commitCount: 0,
        pullRequestCount: 1,
        releaseCount: 1,
        lastActivityAt: '2026-07-26T00:00:00.000Z',
        dataAsOf: '2026-07-27T00:00:00.000Z',
      },
    ]);
  });

  it('skips repository reads when there are no programs', async () => {
    // Given
    const findRepositoryLinks = jest.fn();
    const findRepositoryActivity = jest.fn();
    const repository = {
      findRepositoryLinks,
    } satisfies Pick<ProgramActivitySummaryRepository, 'findRepositoryLinks'>;
    const collection = {
      findRepositoryActivity,
    } satisfies Pick<CollectionReadPort, 'findRepositoryActivity'>;

    // When
    const result = await new ProgramActivitySummaryService(
      repository,
      collection,
    ).summarize([]);

    // Then
    expect(result).toEqual([]);
    expect(findRepositoryLinks).not.toHaveBeenCalled();
    expect(findRepositoryActivity).not.toHaveBeenCalled();
  });
});
