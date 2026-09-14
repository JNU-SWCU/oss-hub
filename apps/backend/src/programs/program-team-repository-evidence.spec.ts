import {
  teamFindFirst,
  applicationFindFirst,
  contributionGroupBy,
  auditFindMany,
  provisionFindUnique,
  givenRepository,
} from './program-team-repository-evidence.fixture';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramTeamRepositoryEvidenceRepository } from './repository/program-team-repository-evidence.repository';

afterEach(() => jest.clearAllMocks());

it('preserves legacy program date boundaries using valid ISO calendar dates', async () => {
  // Given
  givenRepository();
  const repository = new ProgramTeamRepositoryEvidenceRepository(
    new PrismaService(),
  );
  // When
  const view = await repository.contributions(
    {
      repository: {
        id: 'current-repo',
        nameWithOwner: 'synthetic/current',
        lastSuccessAt: null,
        failureCount: 0,
      },
      program: {
        startAt: new Date('0001-01-01T00:00:00.000Z'),
        endAt: new Date('9999-12-31T23:59:59.999Z'),
      },
    },
    [],
  );
  // Then
  expect(view?.window).toEqual({
    from: '0001-01-01',
    to: '+010000-01-01',
    timeZone: 'Asia/Seoul',
  });
  expect(contributionGroupBy).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        repositoryId: 'current-repo',
        date: {
          gte: new Date('0001-01-01T00:00:00.000Z'),
          lte: new Date('+010000-01-01T00:00:00.000Z'),
        },
      },
    }),
  );
});

it('reports an explicit repository relink as succeeded without inventing a provisioning outbox', async () => {
  // Given
  const repository = givenRepository(
    new Date('2026-08-31Z'),
    0,
    'https://github.com/synthetic/current',
  );
  provisionFindUnique.mockResolvedValue({
    status: 'SUCCEEDED',
    updatedAt: new Date('2026-08-31Z'),
    lastErrorCode: null,
    repositoryId: 'current-repo',
  });
  // When
  const detail = await repository.findStaffTeamDetail('program', 'team');
  // Then
  expect(detail?.application?.repositoryProvisioning.jobStatus).toBe(
    'SUCCEEDED',
  );
});

it('continues history with timestamp and ID tie-breaking inside the same scope', async () => {
  // Given
  const repository = givenRepository();
  const cursor = { occurredAt: new Date('2026-08-15Z'), id: 'change-11' };
  // When
  const page = await repository.findStaffRepositoryUrlHistory(
    'program',
    'team',
    cursor,
  );
  // Then
  expect(page).toEqual({ items: [], nextCursor: null });
  const historyQuery: unknown = auditFindMany.mock.calls[0]?.[0];
  expect(historyQuery).toHaveProperty('where.targetId', 'application');
  expect(historyQuery).toHaveProperty('where.OR', [
    { occurredAt: { lt: new Date('2026-08-15Z') } },
    { occurredAt: new Date('2026-08-15Z'), id: { lt: 'change-11' } },
  ]);
  expect(historyQuery).toHaveProperty('take', 21);
});

it('returns an explicit empty evidence state when the team has no application', async () => {
  // Given
  const repository = givenRepository();
  applicationFindFirst.mockResolvedValue(null);
  // When
  const detail = await repository.findStaffTeamDetail('program', 'team');
  // Then
  expect(detail).toMatchObject({
    repositoryContributions: null,
    repositoryUrlHistory: { items: [], nextCursor: null },
  });
  expect(contributionGroupBy).not.toHaveBeenCalled();
  expect(auditFindMany).not.toHaveBeenCalled();
});

it('returns only application-scoped URL history with the actor snapshot', async () => {
  // Given
  const repository = givenRepository();
  auditFindMany.mockResolvedValue([
    {
      id: 'change-1',
      occurredAt: new Date('2026-08-15Z'),
      metadata: {
        schemaVersion: 1,
        programId: 'program',
        teamId: 'team',
        programName: 'Synthetic program',
        actorGithubLogin: 'actor-at-change',
        reason: 'Correct repository',
        before: {
          repositoryId: 'old-repo',
          repositoryUrl: 'https://github.com/synthetic/old',
        },
        after: {
          repositoryId: 'current-repo',
          repositoryUrl: 'https://github.com/synthetic/current',
        },
      },
    },
  ]);
  // When
  const detail = await repository.findStaffTeamDetail('program', 'team');
  // Then
  expect(detail).toMatchObject({
    repositoryUrlHistory: {
      items: [
        {
          id: 'change-1',
          occurredAt: '2026-08-15T00:00:00.000Z',
          actorGithubLogin: 'actor-at-change',
          previousRepositoryUrl: 'https://github.com/synthetic/old',
          newRepositoryUrl: 'https://github.com/synthetic/current',
          reason: 'Correct repository',
        },
      ],
      nextCursor: null,
    },
  });
  expect(auditFindMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        action: 'APPLICATION_REPOSITORY_URL_CHANGED',
        targetType: 'APPLICATION',
        targetId: 'application',
        AND: [
          { metadata: { path: ['programId'], equals: 'program' } },
          { metadata: { path: ['teamId'], equals: 'team' } },
        ],
      },
    }),
  );
});

it('bounds the initial history page and provides a cursor for all remaining history', async () => {
  // Given
  const repository = givenRepository();
  auditFindMany.mockResolvedValue(
    Array.from({ length: 21 }, (_, index) => ({
      id: `change-${String(30 - index).padStart(2, '0')}`,
      occurredAt: new Date('2026-08-15Z'),
      metadata: {
        schemaVersion: 1,
        programId: 'program',
        teamId: 'team',
        programName: 'Synthetic',
        actorGithubLogin: 'actor',
        reason: 'Correction',
        before: { repositoryId: null, repositoryUrl: null },
        after: {
          repositoryId: 'current-repo',
          repositoryUrl: 'https://github.com/synthetic/current',
        },
      },
    })),
  );
  // When
  const detail = await repository.findStaffTeamDetail('program', 'team');
  // Then
  expect(detail?.repositoryUrlHistory).toMatchObject({
    nextCursor: '2026-08-15T00:00:00.000Z_change-11',
  });
  expect(detail?.repositoryUrlHistory).toHaveProperty(
    'items',
    expect.arrayContaining([expect.objectContaining({ id: 'change-11' })]),
  );
  expect(auditFindMany).toHaveBeenCalledWith(
    expect.objectContaining({ take: 21 }),
  );
});

it('matches numeric GitHub identities and preserves members without observations', async () => {
  // Given
  const repository = givenRepository();
  // When
  const detail = await repository.findStaffTeamDetail('program', 'team');
  // Then
  expect(detail).toMatchObject({
    repositoryContributions: {
      repositoryId: 'current-repo',
      repositoryUrl: 'https://github.com/synthetic/current',
      window: { from: '2026-08-01', to: '2026-08-31', timeZone: 'Asia/Seoul' },
      collectionStatus: 'COLLECTED',
      members: [
        {
          userId: 'member-a',
          githubId: '101',
          commitCount: 3,
          pullRequestCount: 2,
          releaseCount: 1,
          hasObservations: true,
        },
        {
          userId: 'member-b',
          githubId: '102',
          commitCount: 0,
          pullRequestCount: 0,
          releaseCount: 0,
          hasObservations: false,
        },
      ],
      unmatchedContributors: [
        {
          githubId: '999',
          commitCount: 4,
          pullRequestCount: 0,
          releaseCount: 0,
        },
      ],
    },
  });
  expect(contributionGroupBy).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        repositoryId: 'current-repo',
        date: { gte: new Date('2026-08-01Z'), lte: new Date('2026-08-31Z') },
      },
    }),
  );
});

it.each([
  [null, 0, 'NOT_COLLECTED'],
  [null, 2, 'ERROR'],
  [new Date('2026-08-31Z'), 2, 'ERROR'],
] as const)(
  'distinguishes collection state when last success is %s and failures are %s',
  async (lastSuccessAt, failureCount, collectionStatus) => {
    // Given
    const repository = givenRepository(lastSuccessAt, failureCount);
    contributionGroupBy.mockResolvedValue([]);
    // When
    const detail = await repository.findStaffTeamDetail('program', 'team');
    // Then
    expect(detail).toMatchObject({
      repositoryContributions: { collectionStatus },
    });
  },
);

it('does not query contributions or history for an absent or differently scoped team', async () => {
  // Given
  const repository = givenRepository();
  teamFindFirst.mockResolvedValue(null);
  // When
  const detail = await repository.findStaffTeamDetail('other-program', 'team');
  // Then
  expect(detail).toBeNull();
  expect(contributionGroupBy).not.toHaveBeenCalled();
  expect(auditFindMany).not.toHaveBeenCalled();
});
