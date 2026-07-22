import {
  ApplicationStatus,
  CollectionRunStatus,
  ObservationSourceType,
  Role,
} from '@prisma/client';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { SessionGuard } from '../auth/session.guard';
import type { PrismaService } from '../prisma/prisma.service';
import { ProgramActivityService } from './program-activity.service';
import type { ProgramViewer } from './program-viewer.service';
import { StudentDashboardController } from './programs.controller';
import { ProgramsRepository } from './programs.repository';

const student: ProgramViewer = {
  githubId: 11n,
  userId: 'student-1',
  role: Role.STUDENT,
};

function event(
  sourceId: string,
  type: string,
  repositoryId: number,
  createdAt: string,
  payload: Readonly<Record<string, unknown>>,
  targetGithubId = 11n,
) {
  return {
    sourceId,
    payload: {
      type,
      repo: { id: repositoryId },
      payload,
      created_at: createdAt,
    },
    run: { targetGithubId },
  };
}

describe('ProgramActivityService activity timeline', () => {
  it('exposes the current-student timeline at the dashboard route behind SessionGuard', () => {
    // Given
    const method: unknown = Object.getOwnPropertyDescriptor(
      StudentDashboardController.prototype,
      'activityTimeline',
    )?.value;
    if (typeof method !== 'function') {
      throw new Error('Activity timeline controller method not found.');
    }

    // When
    const controllerPath: unknown = Reflect.getMetadata(
      PATH_METADATA,
      StudentDashboardController,
    );

    // Then
    expect(controllerPath).toBe('dashboard/student');
    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(
      'activity-timeline',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, method)).toEqual([
      SessionGuard,
    ]);
  });

  it('aggregates approved personal and team activity by month without FORCE data', async () => {
    // Given
    const applicationFindMany = jest.fn().mockResolvedValue([
      {
        teamId: null,
        applicant: { githubId: 11n },
        team: null,
        program: {
          id: 'program-1',
          name: 'Capstone 2026',
          applicationStartAt: new Date('2026-03-01T00:00:00.000Z'),
        },
        repository: { githubRepositoryId: 101n },
      },
      {
        teamId: 'team-1',
        applicant: { githubId: 99n },
        team: {
          leader: { githubId: 11n },
          members: [{ user: { githubId: 11n } }, { user: { githubId: 12n } }],
        },
        program: {
          id: 'program-2',
          name: 'Open Source 2025',
          applicationStartAt: new Date('2025-09-01T00:00:00.000Z'),
        },
        repository: { githubRepositoryId: 202n },
      },
      {
        teamId: null,
        applicant: { githubId: 11n },
        team: null,
        program: {
          id: 'program-3',
          name: 'Approved without repository',
          applicationStartAt: new Date('2027-01-01T00:00:00.000Z'),
        },
        repository: null,
      },
    ]);
    const observationFindMany = jest.fn().mockResolvedValue([
      event('push-1', 'PushEvent', 101, '2026-07-02T23:00:00Z', { size: 3 }),
      event('push-1', 'PushEvent', 101, '2026-07-02T23:00:00Z', { size: 3 }),
      event('pr-1', 'PullRequestEvent', 202, '2026-07-03T00:00:00Z', {
        action: 'opened',
      }),
      event('pr-closed', 'PullRequestEvent', 202, '2026-07-03T01:00:00Z', {
        action: 'closed',
      }),
      event('watch-1', 'WatchEvent', 202, '2025-12-31T23:59:59Z', {
        action: 'started',
      }),
      event('outside-repository', 'PushEvent', 999, '2026-07-04T00:00:00Z', {
        size: 50,
      }),
      event(
        'teammate-push',
        'PushEvent',
        202,
        '2026-07-04T00:00:00Z',
        { size: 100 },
        12n,
      ),
    ]);
    const ownerFindMany = jest
      .fn()
      .mockResolvedValue([{ githubRepositoryId: 202n }]);
    const prisma = {
      application: { findMany: applicationFindMany },
      githubRawObservation: { findMany: observationFindMany },
      repositoryOwnerProjection: { findMany: ownerFindMany },
    } as unknown as PrismaService;
    const service = new ProgramActivityService(new ProgramsRepository(prisma));

    // When
    const result = await service.activityTimeline(student, 'MONTH');

    // Then
    expect(result).toEqual({
      programs: [
        {
          programId: 'program-2',
          programName: 'Open Source 2025',
          year: 2025,
          applicationMode: 'TEAM',
        },
        {
          programId: 'program-1',
          programName: 'Capstone 2026',
          year: 2026,
          applicationMode: 'PERSONAL',
        },
        {
          programId: 'program-3',
          programName: 'Approved without repository',
          year: 2027,
          applicationMode: 'PERSONAL',
        },
      ],
      series: {
        granularity: 'MONTH',
        points: [
          {
            period: '2025-12',
            commitCount: 0,
            prCount: 0,
            starCount: 1,
            total: 1,
          },
          {
            period: '2026-07',
            commitCount: 3,
            prCount: 1,
            starCount: 0,
            total: 4,
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('FORCE');
    expect(applicationFindMany).toHaveBeenCalledWith({
      where: {
        status: ApplicationStatus.APPROVED,
        OR: [
          { applicantId: 'student-1' },
          { team: { leaderId: 'student-1' } },
          { team: { members: { some: { userId: 'student-1' } } } },
        ],
      },
      select: {
        teamId: true,
        applicant: { select: { githubId: true } },
        team: {
          select: {
            leader: { select: { githubId: true } },
            members: {
              select: { user: { select: { githubId: true } } },
            },
          },
        },
        program: {
          select: { id: true, name: true, applicationStartAt: true },
        },
        repository: { select: { githubRepositoryId: true } },
      },
    });
    expect(ownerFindMany).toHaveBeenCalledWith({
      where: {
        ownerGithubId: 11n,
        githubRepositoryId: { in: [101n, 202n] },
      },
      select: { githubRepositoryId: true },
    });
    expect(observationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sourceType: ObservationSourceType.EVENT,
          run: { status: CollectionRunStatus.SUCCEEDED },
          OR: [
            { run: { targetGithubId: 11n } },
            {
              AND: [
                { payload: { path: ['type'], equals: 'WatchEvent' } },
                {
                  payload: {
                    path: ['payload', 'action'],
                    equals: 'started',
                  },
                },
                {
                  OR: [{ payload: { path: ['repo', 'id'], equals: 202 } }],
                },
              ],
            },
          ],
        },
        select: {
          sourceId: true,
          payload: true,
          run: { select: { targetGithubId: true } },
        },
      }),
    );
  });

  it('buckets activity by year', async () => {
    // Given
    const prisma = {
      repository: {
        findMany: jest.fn(),
      },
      application: {
        findMany: jest.fn().mockResolvedValue([
          {
            teamId: null,
            applicant: { githubId: 11n },
            team: null,
            program: {
              id: 'program-1',
              name: 'Capstone',
              applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
            },
            repository: { githubRepositoryId: 101n },
          },
        ]),
      },
      githubRawObservation: {
        findMany: jest.fn().mockResolvedValue([
          event('push-1', 'PushEvent', 101, '2026-01-01T00:00:00Z', {
            size: 2,
          }),
          event('watch-1', 'WatchEvent', 101, '2026-12-31T23:59:59Z', {
            action: 'started',
          }),
        ]),
      },
      repositoryOwnerProjection: {
        findMany: jest.fn().mockResolvedValue([{ githubRepositoryId: 101n }]),
      },
    } as unknown as PrismaService;
    const service = new ProgramActivityService(new ProgramsRepository(prisma));

    // When
    const result = await service.activityTimeline(student, 'YEAR');

    // Then
    expect(result.series).toEqual({
      granularity: 'YEAR',
      points: [
        {
          period: '2026',
          commitCount: 2,
          prCount: 0,
          starCount: 1,
          total: 3,
        },
      ],
    });
  });

  it.each([Role.STAFF, Role.ADMIN, null])(
    'rejects non-student role %s before reading activity',
    async (role) => {
      // Given
      const applicationFindMany = jest.fn();
      const prisma = {
        application: { findMany: applicationFindMany },
      } as unknown as PrismaService;
      const service = new ProgramActivityService(
        new ProgramsRepository(prisma),
      );
      const viewer: ProgramViewer = { githubId: 11n, userId: 'user-1', role };

      // When
      const promise = service.activityTimeline(viewer, 'MONTH');

      // Then
      await expect(promise).rejects.toMatchObject({
        errorCode: { status: 403 },
      });
      expect(applicationFindMany).not.toHaveBeenCalled();
    },
  );
});
