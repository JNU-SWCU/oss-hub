import { Role } from '@prisma/client';
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

function activeGeneration(
  updatedAt: string,
  repositories: readonly {
    readonly githubRepositoryId: bigint;
    readonly commits: readonly { readonly committedAt: Date }[];
    readonly pullRequests: readonly { readonly createdAt: Date }[];
    readonly releases: readonly { readonly publishedAt: Date }[];
  }[],
) {
  return {
    updatedAt: new Date(updatedAt),
    activeGeneration: { repositories },
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

  it('uses only the active complete generation and buckets all three canonical resources', async () => {
    const canonicalFindMany = jest.fn().mockResolvedValue([
      activeGeneration('2026-08-01T00:00:00.000Z', [
        {
          githubRepositoryId: 101n,
          commits: [
            { committedAt: new Date('2026-07-31T15:00:00.000Z') },
            { committedAt: new Date('2026-08-02T00:00:00.000Z') },
          ],
          pullRequests: [{ createdAt: new Date('2026-08-03T00:00:00.000Z') }],
          releases: [{ publishedAt: new Date('2026-08-04T00:00:00.000Z') }],
        },
      ]),
    ]);
    const rawFindMany = jest.fn();
    const prisma = {
      application: { findMany: jest.fn().mockResolvedValue([application]) },
      canonicalOrganizationState: { findMany: canonicalFindMany },
      githubRawObservation: { findMany: rawFindMany },
    } as unknown as PrismaService;

    const result = await new ProgramActivityService(
      new ProgramsRepository(prisma),
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
    expect(canonicalFindMany).toHaveBeenCalledWith({
      where: {
        activeGenerationId: { not: null },
        activeGeneration: {
          status: 'SUCCEEDED',
          repositories: {
            some: { githubRepositoryId: { in: [101n] } },
          },
        },
      },
      select: {
        updatedAt: true,
        activeGeneration: {
          select: {
            repositories: {
              where: { githubRepositoryId: { in: [101n] } },
              select: {
                githubRepositoryId: true,
                commits: {
                  where: { authorGithubId: 11n },
                  select: { committedAt: true },
                },
                pullRequests: {
                  where: { authorGithubId: 11n },
                  select: { createdAt: true },
                },
                releases: {
                  where: { authorGithubId: 11n },
                  select: { publishedAt: true },
                },
              },
            },
          },
        },
      },
    });
    expect(rawFindMany).not.toHaveBeenCalled();
  });

  it('reflects force-push replacement semantics from the active generation', async () => {
    const repository = {
      findStudentActivityApplications: jest
        .fn()
        .mockResolvedValue([application]),
      findCanonicalRepositoryActivity: jest.fn().mockResolvedValue([
        activeGeneration('2026-08-02T00:00:00.000Z', [
          {
            githubRepositoryId: 101n,
            commits: [{ committedAt: new Date('2026-08-01T00:00:00.000Z') }],
            pullRequests: [],
            releases: [],
          },
        ]),
      ]),
    } as unknown as ProgramsRepository;

    const result = await new ProgramActivityService(
      repository,
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

  it.each([
    ['no active generation', []],
    [
      'absent canonical repository mapping',
      [activeGeneration('2026-08-01T00:00:00.000Z', [])],
    ],
  ])('returns an empty series for %s', async (_case, generations) => {
    const repository = {
      findStudentActivityApplications: jest
        .fn()
        .mockResolvedValue([application]),
      findCanonicalRepositoryActivity: jest.fn().mockResolvedValue(generations),
    } as unknown as ProgramsRepository;

    const result = await new ProgramActivityService(
      repository,
    ).activityTimeline(student, 'MONTH');

    expect(result.dataAsOf).toBeNull();
    expect(result.series.points).toEqual([]);
  });

  it('summarizes canonical commits, PRs, releases, activity time, and publication time', async () => {
    const repository = {
      findProgramRepositories: jest.fn().mockResolvedValue([
        {
          githubRepositoryId: 101n,
          application: {
            id: 'application-1',
            applicant: { githubId: 11n, name: 'Student', nickname: 'student' },
            team: null,
          },
        },
      ]),
      findCanonicalRepositoryActivity: jest.fn().mockResolvedValue([
        activeGeneration('2026-08-05T00:00:00.000Z', [
          {
            githubRepositoryId: 101n,
            commits: [{ committedAt: new Date('2026-08-01T00:00:00.000Z') }],
            pullRequests: [{ createdAt: new Date('2026-08-03T00:00:00.000Z') }],
            releases: [{ publishedAt: new Date('2026-08-04T00:00:00.000Z') }],
          },
        ]),
      ]),
    } as unknown as ProgramsRepository;

    await expect(
      new ProgramActivityService(repository).activity('program-1', student),
    ).resolves.toEqual([
      {
        applicationId: 'application-1',
        label: 'Student',
        commitCount: 1,
        pullRequestCount: 1,
        releaseCount: 1,
        lastActivityAt: '2026-08-04T00:00:00.000Z',
        dataAsOf: '2026-08-05T00:00:00.000Z',
      },
    ]);
  });

  it.each([Role.STAFF, Role.ADMIN, null])(
    'rejects non-student role %s before reading activity',
    async (role) => {
      const findStudentActivityApplications = jest.fn();
      const repository = {
        findStudentActivityApplications,
      } as unknown as ProgramsRepository;
      const viewer: ProgramViewer = { githubId: 11n, userId: 'user-1', role };

      await expect(
        new ProgramActivityService(repository).activityTimeline(
          viewer,
          'MONTH',
        ),
      ).rejects.toMatchObject({ errorCode: { status: 403 } });
      expect(findStudentActivityApplications).not.toHaveBeenCalled();
    },
  );
});
