import type { ProgramTrackType } from '@prisma/client';
import type { PrismaService } from '../platform/prisma.service';
import { PublicProjectsRepository } from './public-projects.repository';

type FindManyMock = jest.Mock<Promise<unknown[]>, [unknown]>;
type FindFirstMock = jest.Mock<Promise<unknown>, [unknown]>;
type FindUniqueMock = jest.Mock<Promise<unknown>, [unknown]>;

interface MockPrismaClient {
  repo: { findMany: FindManyMock; findFirst: FindFirstMock };
  user: { findUnique: FindUniqueMock };
  $queryRaw: jest.Mock;
}

function repositoryWith(overrides: {
  repositoryFindMany?: FindManyMock;
  repositoryFindFirst?: FindFirstMock;
  userFindUnique?: FindUniqueMock;
  queryRaw?: jest.Mock;
}): { repository: PublicProjectsRepository; prisma: MockPrismaClient } {
  const prisma: MockPrismaClient = {
    repo: {
      findMany: overrides.repositoryFindMany ?? jest.fn(),
      findFirst: overrides.repositoryFindFirst ?? jest.fn(),
    },
    user: {
      findUnique: overrides.userFindUnique ?? jest.fn(),
    },
    $queryRaw: overrides.queryRaw ?? jest.fn().mockResolvedValue([]),
  };
  return {
    repository: new PublicProjectsRepository(
      prisma as unknown as PrismaService,
    ),
    prisma,
  };
}

const PROJECT_ROW_SELECT = {
  githubRepoId: true,
  ownerName: true,
  publishedAt: true,
  teamRepos: {
    orderBy: { validFrom: 'desc' },
    take: 1,
    select: {
      team: {
        select: {
          programId: true,
          name: true,
          leaderId: true,
          _count: { select: { members: true } },
          members: { select: { userId: true } },
          program: { select: { name: true, trackType: true, lifecycle: true } },
          applicant: { select: { nickname: true } },
        },
      },
    },
  },
};

const LIVE_TEAM_REPOS = {
  some: { team: { program: { lifecycle: { not: 'DELETED' } } } },
};

const RAW_ROW = {
  githubRepoId: 9001n,
  ownerName: 'synthetic-org/synthetic-repo',
  publishedAt: new Date('2026-07-20T00:00:00.000Z'),
  teamRepos: [
    {
      team: {
        programId: 'synthetic-program-1',
        name: 'synthetic-team',
        leaderId: 'synthetic-user-1',
        _count: { members: 1 },
        members: [{ userId: 'synthetic-user-1' }],
        program: {
          name: 'synthetic-program',
          trackType: 'CURRICULAR' as ProgramTrackType,
          lifecycle: 'ACTIVE',
        },
        applicant: { nickname: 'synthetic-applicant' },
      },
    },
  ],
};

describe('PublicProjectsRepository', () => {
  describe('listPage', () => {
    it('첫 페이지(cursor=null)에서는 OR 절 없이 visibility/publishedAt 필터만으로 명시적 select를 쓴다', async () => {
      const findMany = jest.fn().mockResolvedValue([RAW_ROW]);
      const { repository } = repositoryWith({ repositoryFindMany: findMany });

      const rows = await repository.listPage(null, 21);

      expect(findMany).toHaveBeenCalledWith({
        where: {
          visibility: 'PUBLIC',
          teamRepos: LIVE_TEAM_REPOS,
          publishedAt: { not: null },
        },
        orderBy: [{ publishedAt: 'desc' }, { githubRepoId: 'desc' }],
        take: 21,
        select: PROJECT_ROW_SELECT,
      });
      expect(rows).toEqual([
        {
          id: '9001',
          projectId: '9001',
          githubRepositoryId: 9001n,
          nameWithOwner: 'synthetic-org/synthetic-repo',
          publishedAt: RAW_ROW.publishedAt,
          programId: 'synthetic-program-1',
          programName: 'synthetic-program',
          trackType: 'CURRICULAR',
          teamName: 'synthetic-team',
          teamMemberCount: 1,
          applicantNickname: 'synthetic-applicant',
        },
      ]);
    });

    it('cursor가 있으면 (publishedAt, id) keyset OR 절을 where에 덧붙인다', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { repository } = repositoryWith({ repositoryFindMany: findMany });
      const cursor = {
        publishedAt: new Date('2026-07-20T00:00:00.000Z'),
        id: '9001',
      };

      await repository.listPage(cursor, 6);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            visibility: 'PUBLIC',
            teamRepos: LIVE_TEAM_REPOS,
            publishedAt: { not: null },
            OR: [
              { publishedAt: { lt: cursor.publishedAt } },
              { publishedAt: cursor.publishedAt, githubRepoId: { lt: 9001n } },
            ],
          },
          take: 6,
        }),
      );
    });

    it('year가 있으면 Asia/Seoul publishedAt 경계(gte/lt)로 where를 좁힌다', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { repository } = repositoryWith({ repositoryFindMany: findMany });

      await repository.listPage(null, 12, 2026);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            visibility: 'PUBLIC',
            teamRepos: LIVE_TEAM_REPOS,
            publishedAt: {
              gte: new Date('2025-12-31T15:00:00.000Z'),
              lt: new Date('2026-12-31T15:00:00.000Z'),
            },
          },
          take: 12,
        }),
      );
    });

    it.each([
      [2025, '2024-12-31T15:00:00.000Z', '2025-12-31T15:00:00.000Z'],
      [2026, '2025-12-31T15:00:00.000Z', '2026-12-31T15:00:00.000Z'],
    ] as const)(
      'Seoul boundary year=%i uses gte=%s lt=%s',
      async (year, gte, lt) => {
        const findMany = jest.fn().mockResolvedValue([]);
        const { repository } = repositoryWith({ repositoryFindMany: findMany });

        await repository.listPage(null, 6, year);

        expect(findMany).toHaveBeenCalledTimes(1);
        const calls = findMany.mock.calls as Array<
          [{ where: { publishedAt: { gte: Date; lt: Date } } }]
        >;
        const listArgs = calls[0]?.[0];
        expect(listArgs?.where.publishedAt).toEqual({
          gte: new Date(gte),
          lt: new Date(lt),
        });
      },
    );
  });

  describe('listYears', () => {});

  describe('findById', () => {
    it('projectId(githubRepositoryId 문자열)와 visibility/publishedAt 필터를 findFirst where에 함께 걸어 private/미존재를 동일하게 null로 만든다', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const { repository } = repositoryWith({ repositoryFindFirst: findFirst });

      const result = await repository.findById('9001');

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          githubRepoId: 9001n,
          visibility: 'PUBLIC',
          teamRepos: LIVE_TEAM_REPOS,
          publishedAt: { not: null },
        },
        select: PROJECT_ROW_SELECT,
      });
      expect(result).toBeNull();
    });

    it('찾은 행을 PublicProjectRow로 매핑한다', async () => {
      const findFirst = jest.fn().mockResolvedValue(RAW_ROW);
      const { repository } = repositoryWith({ repositoryFindFirst: findFirst });

      const result = await repository.findById('9001');

      expect(result?.projectId).toBe('9001');
      expect(result?.nameWithOwner).toContain('synthetic-repo');
      expect(result?.githubRepositoryId).toBe(9001n);
    });

    it('숫자가 아닌 projectId는 findFirst를 호출하지 않고 null을 반환한다(Repository.id 등 콜론 포함 값 유입 방지)', async () => {
      const findFirst = jest.fn();
      const { repository } = repositoryWith({ repositoryFindFirst: findFirst });

      const result = await repository.findById(
        'seed:repositories:repository-public:repository',
      );

      expect(findFirst).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('listForUser', () => {
    it('현재 팀장과 팀 구성원의 공개 프로젝트를 조회한다', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { repository } = repositoryWith({ repositoryFindMany: findMany });

      await repository.listForUser('synthetic-user-1');

      expect(findMany).toHaveBeenCalledWith({
        where: {
          visibility: 'PUBLIC',
          publishedAt: { not: null },
          teamRepos: {
            some: {
              team: {
                program: { lifecycle: { not: 'DELETED' } },
                OR: [
                  { leaderId: 'synthetic-user-1' },
                  { members: { some: { userId: 'synthetic-user-1' } } },
                ],
              },
            },
          },
        },
        orderBy: [{ publishedAt: 'desc' }, { githubRepoId: 'desc' }],
        select: PROJECT_ROW_SELECT,
      });
    });
  });

  describe('최신 team_repo 기간', () => {
    it('최신 기간의 팀에 사용자가 없으면 과거 기간 소속만으로는 내보내지 않는다', async () => {
      const findMany = jest.fn().mockResolvedValue([RAW_ROW]);
      const { repository } = repositoryWith({ repositoryFindMany: findMany });

      await expect(repository.listForUser('former-member')).resolves.toEqual(
        [],
      );
    });

    it('최신 기간의 팀 프로그램이 삭제됐으면 공개 목록에서 뺀다', async () => {
      const [link] = RAW_ROW.teamRepos;
      const findMany = jest.fn().mockResolvedValue([
        {
          ...RAW_ROW,
          teamRepos: [
            {
              team: {
                ...link!.team,
                program: { ...link!.team.program, lifecycle: 'DELETED' },
              },
            },
          ],
        },
      ]);
      const { repository } = repositoryWith({ repositoryFindMany: findMany });

      await expect(repository.listPage(null, 21)).resolves.toEqual([]);
    });
  });

  describe('findUserIdentity', () => {
    it('id/nickname/avatarUrl/githubId만 명시적으로 select한다(실명·studentId·department·email·role 없음)', async () => {
      const findUnique = jest.fn().mockResolvedValue({
        id: 'synthetic-user-1',
        nickname: 'synthetic-login',
        avatarUrl: null,
        githubId: 501n,
      });
      const { repository } = repositoryWith({ userFindUnique: findUnique });

      const identity = await repository.findUserIdentity('synthetic-user-1');

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 'synthetic-user-1' },
        select: {
          id: true,
          nickname: true,
          avatarUrl: true,
          githubId: true,
        },
      });
      expect(identity).toEqual({
        userId: 'synthetic-user-1',
        githubNickname: 'synthetic-login',
        avatarUrl: null,
        githubId: 501n,
      });
    });

    it('사용자가 없으면 null을 반환한다', async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const { repository } = repositoryWith({ userFindUnique: findUnique });

      await expect(
        repository.findUserIdentity('missing-user'),
      ).resolves.toBeNull();
    });
  });
});
