import type { ProgramActivityRepository } from '../repository/program-activity.repository';
import {
  ProgramActivityService,
  type ProgramActivityProgramStore,
} from './program-activity.service';
import type { ProgramViewer } from './program-viewer.service';

const staff: ProgramViewer = { githubId: 1n, userId: 'staff-1', role: 'STAFF' };
type ApplicationActivity = Awaited<
  ReturnType<ProgramActivityRepository['findProgramActivityApplications']>
>[number];

function application(): ApplicationActivity {
  return {
    id: 'application-1',
    team: {
      name: '팀 A',
      members: [
        { user: { githubId: 11n, nickname: 'student-a' } },
        { user: { githubId: 12n, nickname: 'student-b' } },
      ],
    },
    repository: {
      lastSuccessAt: new Date('2026-07-24T00:00:00.000Z'),
      failureCount: 0,
      _count: { commits: 2, pullRequests: 1, releases: 1 },
      commits: [{ committedAt: new Date('2026-07-21T00:00:00.000Z') }],
      pullRequests: [{ createdAt: new Date('2026-07-22T00:00:00.000Z') }],
      releases: [{ publishedAt: new Date('2026-07-23T00:00:00.000Z') }],
      contributions: [
        { githubId: 11n, commitCount: 1, pullRequestCount: 0, releaseCount: 1 },
        { githubId: 11n, commitCount: 1, pullRequestCount: 1, releaseCount: 0 },
      ],
    },
  };
}

function service(applications: ApplicationActivity[]) {
  const findProgramActivityApplications = jest.fn<
    ReturnType<ProgramActivityRepository['findProgramActivityApplications']>,
    Parameters<ProgramActivityRepository['findProgramActivityApplications']>
  >();
  findProgramActivityApplications.mockResolvedValue(applications);
  const repository: ProgramActivityProgramStore = {
    findProgramRepositories: () => Promise.resolve([]),
    findStudentActivityApplications: () => Promise.resolve([]),
  };
  return {
    findProgramActivityApplications,
    subject: new ProgramActivityService(repository, {
      findProgramActivityApplications,
      findRepositoryActivity: () => Promise.resolve([]),
    }),
  };
}

describe('ProgramActivityService', () => {
  it('기존 fact의 커밋·PR·릴리스와 최근 활동·성공 시각을 반환한다', async () => {
    const { subject, findProgramActivityApplications } = service([
      application(),
    ]);
    const result = await subject.activity('program-1', staff);
    expect(result[0]).toMatchObject({
      applicationId: 'application-1',
      label: '팀 A',
      commitCount: 2,
      pullRequestCount: 1,
      releaseCount: 1,
      lastActivityAt: '2026-07-23T00:00:00.000Z',
      dataAsOf: '2026-07-24T00:00:00.000Z',
      collectionStatus: 'READY',
    });
    expect(findProgramActivityApplications).toHaveBeenCalledWith(
      'program-1',
      null,
    );
  });

  it('사람×날짜 기여를 합산하고 기여가 없는 명단의 팀원도 0으로 남긴다', async () => {
    const { subject } = service([application()]);
    const result = await subject.activity('program-1', staff);
    expect(result[0]?.members).toEqual([
      {
        githubLogin: 'student-a',
        commitCount: 2,
        pullRequestCount: 1,
        releaseCount: 1,
      },
      {
        githubLogin: 'student-b',
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
      },
    ]);
    expect(result[0]?.hasIncompleteContributions).toBe(false);
  });

  it('팀 명단에 없는 기여를 팀원에게 배분하지 않고 불완전함을 알린다', async () => {
    const row = application();
    if (!row.repository) throw new Error('Expected linked fixture');
    row.repository.contributions[0] = {
      githubId: 99n,
      commitCount: 1,
      pullRequestCount: 0,
      releaseCount: 1,
    };
    const result = await service([row]).subject.activity('program-1', staff);
    expect(result[0]?.hasIncompleteContributions).toBe(true);
    expect(result[0]?.commitCount).toBe(2);
    expect(result[0]?.members[0]?.commitCount).toBe(1);
    expect(result[0]?.members).toHaveLength(2);
  });

  it('저장소 미연결 팀에는 숫자를 만들어 넣거나 펼칠 명단을 주지 않는다', async () => {
    const row = application();
    row.repository = null;
    const result = await service([row]).subject.activity('program-1', staff);
    expect(result[0]).toMatchObject({
      collectionStatus: 'NOT_CONNECTED',
      members: [],
      commitCount: 0,
      pullRequestCount: 0,
      releaseCount: 0,
      dataAsOf: null,
      lastActivityAt: null,
    });
  });

  it('연결됐지만 활동이 없으면 EMPTY로 반환한다', async () => {
    const row = application();
    if (!row.repository) throw new Error('Expected linked fixture');
    row.repository._count = { commits: 0, pullRequests: 0, releases: 0 };
    row.repository.commits = [];
    row.repository.pullRequests = [];
    row.repository.releases = [];
    row.repository.contributions = [];
    row.repository.lastSuccessAt = null;
    const result = await service([row]).subject.activity('program-1', staff);
    expect(result[0]).toMatchObject({
      collectionStatus: 'EMPTY',
      dataAsOf: null,
      lastActivityAt: null,
      commitCount: 0,
      pullRequestCount: 0,
      releaseCount: 0,
    });
    expect(result[0]?.members).toHaveLength(2);
  });

  it('수집 실패를 0건으로 위장하지 않고 마지막 수치를 보존한다', async () => {
    const row = application();
    if (!row.repository) throw new Error('Expected linked fixture');
    row.repository.failureCount = 1;
    const result = await service([row]).subject.activity('program-1', staff);
    expect(result[0]).toMatchObject({
      collectionStatus: 'FAILED',
      commitCount: 2,
    });
  });

  it('학생은 기존 참여자 범위로 조회하며 TeamMember가 없는 팀장도 포함한다', async () => {
    const { subject, findProgramActivityApplications } = service([]);
    await subject.activity('program-1', {
      githubId: 11n,
      userId: 'leader-1',
      role: 'STUDENT',
    });
    expect(findProgramActivityApplications).toHaveBeenCalledWith(
      'program-1',
      'leader-1',
    );
  });

  it('조회 오류를 빈 목록으로 숨기지 않는다', async () => {
    const { subject, findProgramActivityApplications } = service([]);
    findProgramActivityApplications.mockRejectedValue(
      new Error('Database unavailable'),
    );
    await expect(subject.activity('program-1', staff)).rejects.toThrow();
  });

  it('미인증 사용자의 조회는 실행하지 않는다', async () => {
    const { subject, findProgramActivityApplications } = service([]);
    await expect(
      subject.activity('program-1', {
        userId: null,
        githubId: null,
        role: null,
      }),
    ).resolves.toEqual([]);
    expect(findProgramActivityApplications).not.toHaveBeenCalled();
  });
});
