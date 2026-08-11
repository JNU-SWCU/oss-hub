import type { ProgramCategory } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { PublicProjectsRepository } from './public-projects.repository';

type FindManyMock = jest.Mock<Promise<unknown[]>, [unknown]>;
type FindFirstMock = jest.Mock<Promise<unknown>, [unknown]>;
type FindUniqueMock = jest.Mock<Promise<unknown>, [unknown]>;

interface MockPrismaClient {
  githubRepository: { findMany: FindManyMock; findFirst: FindFirstMock };
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
    githubRepository: {
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

// PublicProjectsRepository의 PROJECT_ROW_SELECT와 동일한 모양 — wildcard include를 쓰지
// 않는다는 계약을 테스트가 명시적으로 고정한다.
const PROJECT_ROW_SELECT = {
  id: true,
  githubRepositoryId: true,
  nameWithOwner: true,
  publishedAt: true,
  programId: true,
  program: { select: { name: true, category: true } },
  team: { select: { name: true, _count: { select: { members: true } } } },
  application: { select: { applicant: { select: { nickname: true } } } },
};

const RAW_ROW = {
  id: 'synthetic-repository-1',
  githubRepositoryId: 9001n,
  nameWithOwner: 'synthetic-org/synthetic-repo',
  publishedAt: new Date('2026-07-20T00:00:00.000Z'),
  programId: 'synthetic-program-1',
  program: { name: 'synthetic-program', category: 'BASIC' as ProgramCategory },
  team: null,
  application: { applicant: { nickname: 'synthetic-applicant' } },
};

describe('PublicProjectsRepository', () => {
  describe('listPage', () => {
    it('첫 페이지(cursor=null)에서는 OR 절 없이 visibility/publishedAt 필터만으로 명시적 select를 쓴다', async () => {
      const findMany = jest.fn().mockResolvedValue([RAW_ROW]);
      const { repository } = repositoryWith({ repositoryFindMany: findMany });

      const rows = await repository.listPage(null, 21);

      expect(findMany).toHaveBeenCalledWith({
        where: { visibility: 'PUBLIC', publishedAt: { not: null } },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: 21,
        select: {
          id: true,
          githubRepositoryId: true,
          nameWithOwner: true,
          publishedAt: true,
          programId: true,
          program: { select: { name: true, category: true } },
          team: {
            select: { name: true, _count: { select: { members: true } } },
          },
          application: {
            select: { applicant: { select: { nickname: true } } },
          },
        },
      });
      expect(rows).toEqual([
        {
          id: 'synthetic-repository-1',
          projectId: '9001',
          githubRepositoryId: 9001n,
          repositoryName: 'synthetic-repo',
          githubUrl: 'https://github.com/synthetic-org/synthetic-repo',
          publishedAt: RAW_ROW.publishedAt,
          programId: 'synthetic-program-1',
          programName: 'synthetic-program',
          category: 'BASIC',
          teamName: null,
          teamMemberCount: 0,
          applicantNickname: 'synthetic-applicant',
        },
      ]);
    });

    it('cursor가 있으면 (publishedAt, id) keyset OR 절을 where에 덧붙인다', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { repository } = repositoryWith({ repositoryFindMany: findMany });
      const cursor = {
        publishedAt: new Date('2026-07-20T00:00:00.000Z'),
        id: 'synthetic-repository-1',
      };

      await repository.listPage(cursor, 6);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            visibility: 'PUBLIC',
            publishedAt: { not: null },
            OR: [
              { publishedAt: { lt: cursor.publishedAt } },
              { publishedAt: cursor.publishedAt, id: { lt: cursor.id } },
            ],
          },
          take: 6,
        }),
      );
    });

    it('category가 있으면 program.category 필터를 where에 덧붙인다', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { repository } = repositoryWith({ repositoryFindMany: findMany });

      await repository.listPage(null, 12, 'CAPSTONE');

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            visibility: 'PUBLIC',
            publishedAt: { not: null },
            program: { category: 'CAPSTONE' },
          },
          take: 12,
        }),
      );
    });
  });

  describe('countByCategory', () => {
    it('GROUP BY 결과를 number count로 매핑한다', async () => {
      const queryRaw = jest.fn().mockResolvedValue([
        { category: 'BASIC', count: 2n },
        { category: 'CAPSTONE', count: 1n },
      ]);
      const { repository } = repositoryWith({ queryRaw });

      await expect(repository.countByCategory()).resolves.toEqual([
        { category: 'BASIC', count: 2 },
        { category: 'CAPSTONE', count: 1 },
      ]);
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('findById', () => {
    it('projectId(githubRepositoryId 문자열)와 visibility/publishedAt 필터를 findFirst where에 함께 걸어 private/미존재를 동일하게 null로 만든다', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const { repository } = repositoryWith({ repositoryFindFirst: findFirst });

      const result = await repository.findById('9001');

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          githubRepositoryId: 9001n,
          visibility: 'PUBLIC',
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
      expect(result?.repositoryName).toBe('synthetic-repo');
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
    it('단독 지원자/팀 리더/팀 멤버 세 경로를 OR로 한 번에 조회한다', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { repository } = repositoryWith({ repositoryFindMany: findMany });

      await repository.listForUser('synthetic-user-1');

      expect(findMany).toHaveBeenCalledWith({
        where: {
          visibility: 'PUBLIC',
          publishedAt: { not: null },
          OR: [
            {
              teamId: null,
              application: { applicantId: 'synthetic-user-1' },
            },
            { team: { leaderId: 'synthetic-user-1' } },
            { team: { members: { some: { userId: 'synthetic-user-1' } } } },
          ],
        },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        select: PROJECT_ROW_SELECT,
      });
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
