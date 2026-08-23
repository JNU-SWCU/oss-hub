import { MemberKind } from '@prisma/client';
import type {
  ProgramActivityRepository,
  ProgramRepositoryActivity,
} from '../repository/program-activity.repository';
import {
  ProgramActivityService,
  type ProgramActivityProgramStore,
} from './program-activity.service';
import type { ProgramViewer } from './program-viewer.service';

const staff: ProgramViewer = {
  githubId: 1n,
  userId: 'staff-1',
  role: 'STAFF',
};

function repositoryActivity(updatedAt: string): ProgramRepositoryActivity {
  return {
    repositoryId: 101n,
    dataAsOf: new Date(updatedAt),
    commitDates: [
      new Date('2026-07-20T00:00:00.000Z'),
      new Date('2026-07-21T00:00:00.000Z'),
    ],
    pullRequestDates: [new Date('2026-07-22T00:00:00.000Z')],
    releaseDates: [new Date('2026-07-23T00:00:00.000Z')],
  };
}

function activityReads(
  findRepositoryActivity: ProgramActivityRepository['findRepositoryActivity'],
): Pick<ProgramActivityRepository, 'findRepositoryActivity'> {
  return { findRepositoryActivity };
}

const programRepository = {
  githubRepositoryId: 101n,
  application: {
    id: 'application-1',
    applicant: { githubId: 11n, name: '학생', nickname: 'student' },
    // 1인 팀 — label은 team.name을 우선하므로 기존 기대값 '학생'을 유지한다.
    team: {
      name: '학생',
      leader: { githubId: 11n },
      members: [{ user: { githubId: 11n } }],
    },
  },
};

describe('ProgramActivityService', () => {
  it('활성 canonical generation의 커밋·PR·릴리스와 데이터 기준 시각을 요약한다', async () => {
    const findProgramRepositories = jest.fn<
      ReturnType<ProgramActivityProgramStore['findProgramRepositories']>,
      Parameters<ProgramActivityProgramStore['findProgramRepositories']>
    >();
    findProgramRepositories.mockResolvedValue([programRepository]);
    const findRepositoryActivity = jest.fn<
      ReturnType<ProgramActivityRepository['findRepositoryActivity']>,
      Parameters<ProgramActivityRepository['findRepositoryActivity']>
    >();
    findRepositoryActivity.mockResolvedValue([
      repositoryActivity('2026-07-24T00:00:00.000Z'),
    ]);
    const repository = {
      findProgramRepositories,
      findStudentActivityApplications: () => Promise.resolve([]),
    } satisfies ProgramActivityProgramStore;

    const result = await new ProgramActivityService(
      repository,
      activityReads(findRepositoryActivity),
    ).activity('program-1', staff);

    expect(result).toEqual([
      {
        applicationId: 'application-1',
        label: '학생',
        commitCount: 2,
        pullRequestCount: 1,
        releaseCount: 1,
        lastActivityAt: '2026-07-23T00:00:00.000Z',
        dataAsOf: '2026-07-24T00:00:00.000Z',
      },
    ]);
    expect(findProgramRepositories).toHaveBeenCalledWith('program-1', null);
    expect(findRepositoryActivity).toHaveBeenCalledWith({
      repositoryIds: [101n],
    });
  });

  it('활성 generation이 없으면 저장소를 빈 canonical 요약으로 반환한다', async () => {
    const findProgramRepositories = jest.fn<
      ReturnType<ProgramActivityProgramStore['findProgramRepositories']>,
      Parameters<ProgramActivityProgramStore['findProgramRepositories']>
    >();
    findProgramRepositories.mockResolvedValue([programRepository]);
    const findRepositoryActivity = jest.fn<
      ReturnType<ProgramActivityRepository['findRepositoryActivity']>,
      Parameters<ProgramActivityRepository['findRepositoryActivity']>
    >();
    findRepositoryActivity.mockResolvedValue([]);
    const repository = {
      findProgramRepositories,
      findStudentActivityApplications: () => Promise.resolve([]),
    } satisfies ProgramActivityProgramStore;

    await expect(
      new ProgramActivityService(
        repository,
        activityReads(findRepositoryActivity),
      ).activity('program-1', staff),
    ).resolves.toEqual([
      {
        applicationId: 'application-1',
        label: '학생',
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
        lastActivityAt: null,
        dataAsOf: null,
      },
    ]);
  });

  it('TeamMember 행이 없는 팀장도 팀 저장소 조회 범위에 포함된다', async () => {
    const findProgramRepositories = jest.fn<
      ReturnType<ProgramActivityProgramStore['findProgramRepositories']>,
      Parameters<ProgramActivityProgramStore['findProgramRepositories']>
    >();
    findProgramRepositories.mockResolvedValue([]);
    const findRepositoryActivity = jest.fn<
      ReturnType<ProgramActivityRepository['findRepositoryActivity']>,
      Parameters<ProgramActivityRepository['findRepositoryActivity']>
    >();
    findRepositoryActivity.mockResolvedValue([]);
    const repository = {
      findProgramRepositories,
      findStudentActivityApplications: () => Promise.resolve([]),
    } satisfies ProgramActivityProgramStore;
    const leader: ProgramViewer = {
      githubId: 11n,
      userId: 'leader-1',
      role: 'STUDENT',
    };

    await new ProgramActivityService(
      repository,
      activityReads(findRepositoryActivity),
    ).activity('program-1', leader);

    expect(findProgramRepositories).toHaveBeenCalledWith(
      'program-1',
      'leader-1',
    );
  });
});
