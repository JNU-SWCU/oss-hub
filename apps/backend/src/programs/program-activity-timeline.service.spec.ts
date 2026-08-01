import { Role } from '@prisma/client';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { SessionGuard } from '../auth/session.guard';
import type {
  CollectionReadPort,
  CollectionRepositoryActivityDto,
} from '../collection/collection-read.port';
import {
  ProgramActivityService,
  type ProgramActivityRepository,
} from './program-activity.service';
import type { ProgramViewer } from './program-viewer.service';
import { StudentDashboardController } from './programs.controller';

const student: ProgramViewer = {
  githubId: 11n,
  userId: 'student-1',
  role: Role.STUDENT,
};

const application = {
  teamId: null,
  applicant: { githubId: 11n },
  team: null,
  program: {
    id: 'program-1',
    name: 'Capstone 2026',
    applicationStartAt: new Date('2026-03-01T00:00:00.000Z'),
  },
  repository: { githubRepositoryId: 101n },
};

function repositoryActivity(
  dataAsOf: string,
  fields: Pick<
    CollectionRepositoryActivityDto,
    'commitDates' | 'pullRequestDates' | 'releaseDates'
  >,
): CollectionRepositoryActivityDto {
  return {
    repositoryId: 101n,
    dataAsOf: new Date(dataAsOf),
    ...fields,
  };
}

function collectionReadPort(
  findRepositoryActivity: CollectionReadPort['findRepositoryActivity'],
): CollectionReadPort {
  return {
    findRepositoryActivity,
    findRankingActivity: () => Promise.resolve([]),
    getStatusSnapshot: () => Promise.resolve(null),
    getRepositoryMetrics: () => Promise.resolve([]),
    getContributorMetrics: () => Promise.resolve([]),
    getPublicRankingMetrics: () => Promise.resolve([]),
    getRepositoryCumulativeMetrics: () => Promise.resolve([]),
    getContributorCumulativeMetrics: () => Promise.resolve([]),
    getIncrementalStatusSnapshot: () =>
      Promise.resolve({
        trackedRepositoryCount: 0,
        readyStreamCount: 0,
        backfillingStreamCount: 0,
        partialStreamCount: 0,
        retryPendingStreamCount: 0,
        oldestReadyCheckpointAt: null,
        latestCheckpointAt: null,
        oldestRetryPendingAt: null,
        lastCycleStartedAt: null,
        lastCycleCompletedAt: null,
      }),
  };
}

describe('ProgramActivityService canonical activity', () => {
  it('exposes the current-student timeline at the dashboard route behind SessionGuard', () => {
    const method: unknown = Object.getOwnPropertyDescriptor(
      StudentDashboardController.prototype,
      'activityTimeline',
    )?.value;
    if (typeof method !== 'function') {
      throw new Error('Activity timeline controller method not found.');
    }

    expect(Reflect.getMetadata(PATH_METADATA, StudentDashboardController)).toBe(
      'dashboard/student',
    );
    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(
      'activity-timeline',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, method)).toEqual([
      SessionGuard,
    ]);
  });

  it('buckets all three collection resources from the latest observed activity', async () => {
    const findRepositoryActivity = jest.fn<
      ReturnType<CollectionReadPort['findRepositoryActivity']>,
      Parameters<CollectionReadPort['findRepositoryActivity']>
    >();
    findRepositoryActivity.mockResolvedValue([
      repositoryActivity('2026-08-01T00:00:00.000Z', {
        commitDates: [
          new Date('2026-07-31T15:00:00.000Z'),
          new Date('2026-08-02T00:00:00.000Z'),
        ],
        pullRequestDates: [new Date('2026-08-03T00:00:00.000Z')],
        releaseDates: [new Date('2026-08-04T00:00:00.000Z')],
      }),
    ]);
    const repository = {
      findProgramRepositories: () => Promise.resolve([]),
      findStudentActivityApplications: () => Promise.resolve([application]),
    } satisfies ProgramActivityRepository;

    const result = await new ProgramActivityService(
      repository,
      collectionReadPort(findRepositoryActivity),
    ).activityTimeline(student, 'MONTH');

    expect(result.dataAsOf).toBe('2026-08-01T00:00:00.000Z');
    expect(result.series.points).toEqual([
      {
        period: '2026-08',
        commitCount: 2,
        prCount: 1,
        releaseCount: 1,
        total: 4,
      },
    ]);
    expect(findRepositoryActivity).toHaveBeenCalledWith({
      repositoryIds: [101n],
      authorGithubId: 11n,
    });
  });

  it('reflects force-push replacement semantics from the latest observed activity', async () => {
    const findRepositoryActivity = jest.fn<
      ReturnType<CollectionReadPort['findRepositoryActivity']>,
      Parameters<CollectionReadPort['findRepositoryActivity']>
    >();
    findRepositoryActivity.mockResolvedValue([
      repositoryActivity('2026-08-02T00:00:00.000Z', {
        commitDates: [new Date('2026-08-01T00:00:00.000Z')],
        pullRequestDates: [],
        releaseDates: [],
      }),
    ]);
    const repository = {
      findProgramRepositories: () => Promise.resolve([]),
      findStudentActivityApplications: () => Promise.resolve([application]),
    } satisfies ProgramActivityRepository;

    const result = await new ProgramActivityService(
      repository,
      collectionReadPort(findRepositoryActivity),
    ).activityTimeline(student, 'MONTH');

    expect(result.dataAsOf).toBe('2026-08-02T00:00:00.000Z');
    expect(result.series.points).toEqual([
      {
        period: '2026-08',
        commitCount: 1,
        prCount: 0,
        releaseCount: 0,
        total: 1,
      },
    ]);
  });

  it('returns an empty series with no data-as-of when no activity is observed', async () => {
    const findRepositoryActivity = jest.fn<
      ReturnType<CollectionReadPort['findRepositoryActivity']>,
      Parameters<CollectionReadPort['findRepositoryActivity']>
    >();
    findRepositoryActivity.mockResolvedValue([]);
    const repository = {
      findProgramRepositories: () => Promise.resolve([]),
      findStudentActivityApplications: () => Promise.resolve([application]),
    } satisfies ProgramActivityRepository;

    const result = await new ProgramActivityService(
      repository,
      collectionReadPort(findRepositoryActivity),
    ).activityTimeline(student, 'MONTH');

    expect(result.dataAsOf).toBeNull();
    expect(result.series.points).toEqual([]);
  });

  it('returns an empty series but a real data-as-of when the repository has no dated events', async () => {
    const findRepositoryActivity = jest.fn<
      ReturnType<CollectionReadPort['findRepositoryActivity']>,
      Parameters<CollectionReadPort['findRepositoryActivity']>
    >();
    findRepositoryActivity.mockResolvedValue([
      repositoryActivity('2026-08-01T00:00:00.000Z', {
        commitDates: [],
        pullRequestDates: [],
        releaseDates: [],
      }),
    ]);
    const repository = {
      findProgramRepositories: () => Promise.resolve([]),
      findStudentActivityApplications: () => Promise.resolve([application]),
    } satisfies ProgramActivityRepository;

    const result = await new ProgramActivityService(
      repository,
      collectionReadPort(findRepositoryActivity),
    ).activityTimeline(student, 'MONTH');

    expect(result.dataAsOf).toBe('2026-08-01T00:00:00.000Z');
    expect(result.series.points).toEqual([]);
  });

  it.each([Role.STAFF, Role.ADMIN, null])(
    'rejects non-student role %s before reading activity',
    async (role) => {
      const findStudentActivityApplications = jest.fn();
      const findRepositoryActivity = jest.fn<
        ReturnType<CollectionReadPort['findRepositoryActivity']>,
        Parameters<CollectionReadPort['findRepositoryActivity']>
      >();
      const repository = {
        findStudentActivityApplications,
      } as unknown as ProgramActivityRepository;
      const viewer: ProgramViewer = { githubId: 11n, userId: 'user-1', role };

      await expect(
        new ProgramActivityService(
          repository,
          collectionReadPort(findRepositoryActivity),
        ).activityTimeline(viewer, 'MONTH'),
      ).rejects.toMatchObject({ errorCode: { status: 403 } });
      expect(findStudentActivityApplications).not.toHaveBeenCalled();
      expect(findRepositoryActivity).not.toHaveBeenCalled();
    },
  );
});
