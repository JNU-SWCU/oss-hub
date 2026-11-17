import { ProgramActivitySummaryService } from './program-activity-summary.service';

describe('ProgramActivitySummaryService', () => {
  it('keeps the requested program order and fills programs without repositories with zeros', async () => {
    const summarizePrograms = jest.fn().mockResolvedValue([
      {
        programId: 'program-b',
        repositoryCount: 2,
        commitCount: 3,
        pullRequestCount: 1,
        releaseCount: 0,
        lastActivityAt: new Date('2026-08-05T00:00:00.000Z'),
        dataAsOf: new Date('2026-08-06T00:00:00.000Z'),
      },
    ]);

    const result = await new ProgramActivitySummaryService({
      summarizePrograms,
    }).summarize(['program-a', 'program-b']);

    expect(summarizePrograms).toHaveBeenCalledWith(['program-a', 'program-b']);
    expect(result).toEqual([
      {
        programId: 'program-a',
        repositoryCount: 0,
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
        lastActivityAt: null,
        dataAsOf: null,
      },
      {
        programId: 'program-b',
        repositoryCount: 2,
        commitCount: 3,
        pullRequestCount: 1,
        releaseCount: 0,
        lastActivityAt: '2026-08-05T00:00:00.000Z',
        dataAsOf: '2026-08-06T00:00:00.000Z',
      },
    ]);
  });

  it('does not query for an empty program list', async () => {
    const summarizePrograms = jest.fn();

    await expect(
      new ProgramActivitySummaryService({ summarizePrograms }).summarize([]),
    ).resolves.toEqual([]);
    expect(summarizePrograms).not.toHaveBeenCalled();
  });
});
