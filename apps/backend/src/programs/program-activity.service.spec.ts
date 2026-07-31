import { Role } from '@prisma/client';
import { ProgramActivityService } from './program-activity.service';
import type { ProgramViewer } from './program-viewer.service';
import type { ProgramsRepository } from './programs.repository';

const staff: ProgramViewer = {
  githubId: 1n,
  userId: 'staff-1',
  role: Role.STAFF,
};

function repositoryActivity(updatedAt: string) {
  return {
    updatedAt: new Date(updatedAt),
    activeGeneration: {
      finishedAt: new Date(updatedAt),
      repositories: [
        {
          githubRepositoryId: 101n,
          commits: [
            { committedAt: new Date('2026-07-20T00:00:00.000Z') },
            { committedAt: new Date('2026-07-21T00:00:00.000Z') },
          ],
          pullRequests: [{ createdAt: new Date('2026-07-22T00:00:00.000Z') }],
          releases: [{ publishedAt: new Date('2026-07-23T00:00:00.000Z') }],
        },
      ],
    },
  };
}

const programRepository = {
  githubRepositoryId: 101n,
  application: {
    id: 'application-1',
    applicant: { githubId: 11n, name: '학생', nickname: 'student' },
    team: null,
  },
};

describe('ProgramActivityService', () => {
  it('활성 canonical generation의 커밋·PR·릴리스와 데이터 기준 시각을 요약한다', async () => {
    const findProgramRepositories = jest
      .fn()
      .mockResolvedValue([programRepository]);
    const findCanonicalRepositoryActivity = jest
      .fn()
      .mockResolvedValue([repositoryActivity('2026-07-24T00:00:00.000Z')]);
    const repository = {
      findProgramRepositories,
      findCanonicalRepositoryActivity,
    } as unknown as ProgramsRepository;

    const result = await new ProgramActivityService(repository).activity(
      'program-1',
      staff,
    );

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
    expect(findCanonicalRepositoryActivity).toHaveBeenCalledWith([101n]);
  });

  it('활성 generation이 없으면 저장소를 빈 canonical 요약으로 반환한다', async () => {
    const repository = {
      findProgramRepositories: jest.fn().mockResolvedValue([programRepository]),
      findCanonicalRepositoryActivity: jest.fn().mockResolvedValue([]),
    } as unknown as ProgramsRepository;

    await expect(
      new ProgramActivityService(repository).activity('program-1', staff),
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
    const findProgramRepositories = jest.fn().mockResolvedValue([]);
    const repository = {
      findProgramRepositories,
      findCanonicalRepositoryActivity: jest.fn().mockResolvedValue([]),
    } as unknown as ProgramsRepository;
    const leader: ProgramViewer = {
      githubId: 11n,
      userId: 'leader-1',
      role: Role.STUDENT,
    };

    await new ProgramActivityService(repository).activity('program-1', leader);

    expect(findProgramRepositories).toHaveBeenCalledWith(
      'program-1',
      'leader-1',
    );
  });
});
