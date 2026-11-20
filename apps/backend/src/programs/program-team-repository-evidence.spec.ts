import { Prisma } from '@prisma/client';
import { StudentRepositoryUrlService } from './team-application.service';
import {
  teamFindFirst,
  historyQuery,
  provisionFindUnique,
  givenRepository,
} from './program-team-repository-evidence.fixture';
import { type RepositoryUrlHistoryRows } from './program-team-repository-evidence.repository';
import { TeamMembershipService } from './team-membership.service';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { RepositoryPublishService } from '../github/repository-publish.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { MilestoneCompletionService } from './submissions.service';

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-08-31T01:00:00Z') });
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

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

it('reports an explicit repository relink as succeeded without inventing a provisioning outbox', async () => {
  const repository = givenRepository('OWN');
  provisionFindUnique.mockResolvedValue({
    status: 'SUCCEEDED',
    updatedAt: new Date('2026-08-31Z'),
    lastErrorCode: null,
    repoId: 4242n,
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
  const query = Prisma.sql(...historyQuery.mock.calls[0]!);
  expect(query.values).toEqual([
    'team',
    'program',
    cursor.occurredAt,
    cursor.occurredAt,
    cursor.occurredAt,
    cursor.id,
  ]);
  expect(query.sql).toContain(
    'ORDER BY h."occurredAt" DESC, h.id DESC LIMIT 21',
  );
});

it('reads the application state from the same Team row', async () => {
  const repository = givenRepository();

  const detail = await repository.findStaffTeamDetail('program', 'team');

  expect(detail).toMatchObject({
    application: { id: 'team', status: 'APPROVED' },
  });
  expect(historyQuery).not.toHaveBeenCalled();
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

  const history = await repository.findStaffRepositoryUrlHistory(
    'program',
    'team',
  );

  expect(toPage(history ?? undefined)).toMatchObject({
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
  expect(Prisma.sql(...historyQuery.mock.calls[0]!).values).toEqual([
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

  const history = await repository.findStaffRepositoryUrlHistory(
    'program',
    'team',
  );

  const page = toPage(history ?? undefined);
  expect(page).toMatchObject({
    nextCursor: '2026-08-15T00:00:00.000Z_change-11',
  });
  expect(page).toHaveProperty(
    'items',
    expect.arrayContaining([expect.objectContaining({ id: 'change-11' })]),
  );
  expect(Prisma.sql(...historyQuery.mock.calls[0]!).values).toEqual([
    'team',
    'program',
    null,
    null,
    null,
    null,
  ]);
});

it('does not query history for an absent or differently scoped team', async () => {
  const repository = givenRepository();
  teamFindFirst.mockResolvedValue(null);

  const history = await repository.findStaffRepositoryUrlHistory(
    'other-program',
    'team',
  );

  expect(history).toBeNull();
  expect(historyQuery).not.toHaveBeenCalled();
});
