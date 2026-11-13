import { StudentRepositoryUrlService } from './team-application.service';
import {
  teamFindFirst,
  contributionQuery,
  historyQuery,
  provisionFindUnique,
  givenRepository,
} from './program-team-repository-evidence.fixture';
import { PrismaService } from '../platform/prisma.service';
import {
  ProgramTeamRepositoryEvidenceRepository,
  type RepositoryUrlHistoryRows,
} from './program-team-repository-evidence.repository';
import { TeamMembershipService } from './team-membership.service';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { RepositoryPublishService } from '../github/repository-publish.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { MilestoneCompletionService } from './submissions.service';

afterEach(() => jest.clearAllMocks());

function toPage(history: RepositoryUrlHistoryRows | undefined) {
  return new TeamMembershipService(
    undefined as never,
    undefined as never,
    new HistoryMetadataService(),
    new RepositoryPublishService(),
    new RepositoryUrlService(),
    new MilestoneCompletionService(),
    new StudentRepositoryUrlService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ),
  )['toRepositoryUrlHistoryPage'](history!, {
    programId: 'program',
    teamId: 'team',
  });
}

it('keeps the sentinel window but bounds the query by the last queryable day', async () => {
  givenRepository();
  const repository = new ProgramTeamRepositoryEvidenceRepository(
    new PrismaService(),
  );

  const view = await repository.contributions(
    {
      id: 'application',
      repository: {
        id: 'current-repo',
        nameWithOwner: 'synthetic/current',
        lastSuccessAt: null,
        failureCount: 0,
      },
      program: {
        id: 'program',
        startAt: new Date('0001-01-01T00:00:00.000Z'),
        endAt: new Date('9999-12-31T23:59:59.999Z'),
      },
    },
    [],
  );

  expect(view?.window).toEqual({
    from: '0001-01-01',
    to: '+010000-01-01',
    timeZone: 'Asia/Seoul',
  });
  expect(contributionQuery.mock.calls[0]?.slice(1)).toEqual([
    'current-repo',
    '0001-01-01',
    '9999-12-31',
  ]);
});

it('reports an explicit repository relink as succeeded without inventing a provisioning outbox', async () => {
  const repository = givenRepository(new Date('2026-08-31Z'), 0, 'OWN');
  provisionFindUnique.mockResolvedValue({
    status: 'SUCCEEDED',
    updatedAt: new Date('2026-08-31Z'),
    lastErrorCode: null,
    repositoryId: 'current-repo',
  });

  const detail = await repository.findStaffTeamDetail('program', 'team');

  expect(
    new TeamMembershipService(
      undefined as never,
      undefined as never,
      new HistoryMetadataService(),
      new RepositoryPublishService(),
      new RepositoryUrlService(),
      new MilestoneCompletionService(),
      new StudentRepositoryUrlService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    )['toTeamApplicationView'](detail!.application!).repositoryProvisioning
      .jobStatus,
  ).toBe('SUCCEEDED');
});

it('continues history with timestamp and ID tie-breaking inside the same scope', async () => {
  const repository = givenRepository();
  const cursor = { occurredAt: new Date('2026-08-15Z'), id: 'change-11' };

  const page = await repository.findStaffRepositoryUrlHistory(
    'program',
    'team',
    cursor,
  );

  expect(page).toEqual({
    teamId: 'team',
    rows: [],
    hasMore: false,
  });
  const [sql, ...bindings] = historyQuery.mock.calls[0]!;
  expect(bindings).toEqual([
    'team',
    'program',
    cursor.occurredAt,
    cursor.occurredAt,
    cursor.occurredAt,
    cursor.id,
  ]);
  expect(sql.join('?')).toContain(
    'ORDER BY h."occurredAt" DESC, h.id DESC LIMIT 21',
  );
});

it('reads the application state from the same Team row', async () => {
  const repository = givenRepository();

  const detail = await repository.findStaffTeamDetail('program', 'team');

  expect(detail).toMatchObject({
    application: { id: 'team', status: 'APPROVED' },
    repositoryContributions: {
      repositoryId: 'current-repo',
      collectionStatus: 'COLLECTED',
    },
    repositoryUrlHistory: { rows: [], hasMore: false },
  });
  expect(contributionQuery).toHaveBeenCalledTimes(1);
  expect(historyQuery).toHaveBeenCalledTimes(1);
});

it('returns only application-scoped URL history with the actor snapshot', async () => {
  const repository = givenRepository();
  historyQuery.mockResolvedValue([
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

  const detail = await repository.findStaffTeamDetail('program', 'team');

  expect(toPage(detail?.repositoryUrlHistory)).toMatchObject({
    items: [
      {
        id: 'change-1',
        occurredAt: '2026-08-15T00:00:00.000Z',
        actorGithubLogin: 'actor-at-change',
        previousRepositoryUrl: 'https://github.com/synthetic/old',
        newRepositoryUrl: 'https://github.com/synthetic/current',
      },
    ],
    nextCursor: null,
  });
  expect(historyQuery.mock.calls[0]?.slice(1)).toEqual([
    'team',
    'program',
    null,
    null,
    null,
    null,
  ]);
});

it('bounds the initial history page and provides a cursor for all remaining history', async () => {
  const repository = givenRepository();
  historyQuery.mockResolvedValue(
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

  const detail = await repository.findStaffTeamDetail('program', 'team');

  const page = toPage(detail?.repositoryUrlHistory);
  expect(page).toMatchObject({
    nextCursor: '2026-08-15T00:00:00.000Z_change-11',
  });
  expect(page).toHaveProperty(
    'items',
    expect.arrayContaining([expect.objectContaining({ id: 'change-11' })]),
  );
  expect(historyQuery.mock.calls[0]?.slice(1)).toEqual([
    'team',
    'program',
    null,
    null,
    null,
    null,
  ]);
});

it('matches numeric GitHub identities and preserves members without observations', async () => {
  const repository = givenRepository();

  const detail = await repository.findStaffTeamDetail('program', 'team');

  expect(detail).toMatchObject({
    repositoryContributions: {
      repositoryId: 'current-repo',
      nameWithOwner: 'synthetic/current',
      window: { from: '2026-08-01', to: '2026-08-31', timeZone: 'Asia/Seoul' },
      collectionStatus: 'COLLECTED',
      members: [
        {
          userId: 'member-a',
          githubId: '101',
          commitCount: 3,
          pullRequestCount: 2,
          releaseCount: 1,
          issueCount: 0,
          hasObservations: true,
        },
        {
          userId: 'member-b',
          githubId: '102',
          commitCount: 0,
          pullRequestCount: 0,
          releaseCount: 0,
          issueCount: 0,
          hasObservations: false,
        },
      ],
    },
  });
  expect(contributionQuery.mock.calls[0]?.slice(1)).toEqual([
    'current-repo',
    '2026-08-01',
    '2026-08-31',
  ]);
});

it.each([
  [null, 0, 'NOT_COLLECTED'],
  [null, 2, 'ERROR'],
  [new Date('2026-08-31Z'), 2, 'ERROR'],
] as const)(
  'distinguishes collection state when last success is %s and failures are %s',
  async (lastSuccessAt, failureCount, collectionStatus) => {
    const repository = givenRepository(lastSuccessAt, failureCount);
    contributionQuery.mockResolvedValue([]);

    const detail = await repository.findStaffTeamDetail('program', 'team');

    expect(detail).toMatchObject({
      repositoryContributions: { collectionStatus },
    });
  },
);

it('does not query contributions or history for an absent or differently scoped team', async () => {
  const repository = givenRepository();
  teamFindFirst.mockResolvedValue(null);

  const detail = await repository.findStaffTeamDetail('other-program', 'team');

  expect(detail).toBeNull();
  expect(contributionQuery).not.toHaveBeenCalled();
  expect(historyQuery).not.toHaveBeenCalled();
});
