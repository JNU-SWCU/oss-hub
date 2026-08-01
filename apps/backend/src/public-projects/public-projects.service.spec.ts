import type {
  CollectionContributorCumulativeMetricsDto,
  CollectionReadPort,
  CollectionRepositoryCumulativeMetricsDto,
} from '../collection/collection-read.port';
import { DomainException } from '../common/error-code';
import type { PublicEligibilityService } from '../public-eligibility/public-eligibility.service';
import { encodePublicProjectCursor } from './public-project-cursor';
import type {
  PublicProjectRow,
  PublicProjectsRepository,
  PublicUserIdentity,
} from './public-projects.repository';
import { PublicProjectsService } from './public-projects.service';

function githubRepositoryIdFor(id: string): bigint {
  let hash = 9000;
  for (let index = 0; index < id.length; index += 1) {
    hash = hash * 31 + id.charCodeAt(index);
  }
  return BigInt(Math.abs(hash));
}

function row(
  overrides: Partial<PublicProjectRow> & { id: string },
): PublicProjectRow {
  return {
    githubRepositoryId: githubRepositoryIdFor(overrides.id),
    repositoryName: `repo-${overrides.id}`,
    githubUrl: `https://github.com/synthetic-org/${overrides.id}`,
    publishedAt: new Date('2026-07-20T00:00:00.000Z'),
    programId: 'synthetic-program-1',
    programName: 'synthetic-program',
    category: 'BASIC',
    teamName: null,
    applicantNickname: 'synthetic-applicant',
    ...overrides,
  };
}

function serviceWith(overrides: {
  listPage?: jest.Mock;
  findById?: jest.Mock;
  listForUser?: jest.Mock;
  findUserIdentity?: jest.Mock;
  filterEligibleRepositoryIds?: jest.Mock;
  isEligible?: jest.Mock;
  getRepositoryCumulativeMetrics?: jest.Mock;
  getContributorCumulativeMetrics?: jest.Mock;
}) {
  const repository = {
    listPage: overrides.listPage ?? jest.fn().mockResolvedValue([]),
    findById: overrides.findById ?? jest.fn().mockResolvedValue(null),
    listForUser: overrides.listForUser ?? jest.fn().mockResolvedValue([]),
    findUserIdentity:
      overrides.findUserIdentity ?? jest.fn().mockResolvedValue(null),
  } as unknown as PublicProjectsRepository;
  const eligibility = {
    filterEligibleRepositoryIds:
      overrides.filterEligibleRepositoryIds ??
      jest.fn().mockResolvedValue(new Set()),
    isEligible: overrides.isEligible ?? jest.fn().mockResolvedValue(false),
  } as unknown as PublicEligibilityService;
  const collection = {
    findRepositoryActivity: jest.fn(),
    findRankingActivity: jest.fn(),
    getStatusSnapshot: jest.fn(),
    getRepositoryMetrics: jest.fn(),
    getContributorMetrics: jest.fn(),
    getPublicRankingMetrics: jest.fn(),
    getIncrementalStatusSnapshot: jest.fn(),
    getRepositoryCumulativeMetrics:
      overrides.getRepositoryCumulativeMetrics ??
      jest.fn().mockResolvedValue([]),
    getContributorCumulativeMetrics:
      overrides.getContributorCumulativeMetrics ??
      jest.fn().mockResolvedValue([]),
  } as unknown as CollectionReadPort;
  const service = new PublicProjectsService(
    repository,
    eligibility,
    collection,
  );
  return { service, repository, eligibility, collection };
}

describe('PublicProjectsService', () => {
  describe('findPage — N+1 회귀 가드', () => {
    it.each([1, 5, 20, 50])(
      'pageSize=%i 라도 원본 조회 1개 + eligibility 배치 조회 1개, 총 2개 질의로 고정된다',
      async (pageSize) => {
        const rawRows = Array.from({ length: pageSize }, (_, index) =>
          row({ id: `synthetic-repository-${index}` }),
        );
        const listPage = jest.fn().mockResolvedValue(rawRows);
        const filterEligibleRepositoryIds = jest
          .fn()
          .mockResolvedValue(new Set(rawRows.map((r) => r.githubRepositoryId)));
        const { service } = serviceWith({
          listPage,
          filterEligibleRepositoryIds,
        });

        await service.findPage(undefined, pageSize);

        expect(listPage).toHaveBeenCalledTimes(1);
        expect(filterEligibleRepositoryIds).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('findPage — 페이지 경계/커서', () => {
    it('lookahead(pageSize+1) 행을 요청하고 pageSize만큼만 잘라 반환한다', async () => {
      const pageSize = 2;
      const rawRows = [
        row({ id: 'a' }),
        row({ id: 'b' }),
        row({ id: 'c' }), // lookahead용 3번째 행 — 응답 아이템에는 포함되지 않는다.
      ];
      const listPage = jest.fn().mockResolvedValue(rawRows);
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(new Set(rawRows.map((r) => r.githubRepositoryId)));
      const { service } = serviceWith({
        listPage,
        filterEligibleRepositoryIds,
      });

      const page = await service.findPage(undefined, pageSize);

      expect(listPage).toHaveBeenCalledWith(null, pageSize + 1);
      expect(page.items).toHaveLength(2);
      expect(page.items.map((item) => item.id)).toEqual(['a', 'b']);
      expect(page.nextPageId).not.toBeNull();
    });

    it('lookahead 행이 없으면(더 볼 페이지 없음) nextPageId가 null이다', async () => {
      const pageSize = 2;
      const rawRows = [row({ id: 'a' }), row({ id: 'b' })];
      const listPage = jest.fn().mockResolvedValue(rawRows);
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(new Set(rawRows.map((r) => r.githubRepositoryId)));
      const { service } = serviceWith({
        listPage,
        filterEligibleRepositoryIds,
      });

      const page = await service.findPage(undefined, pageSize);

      expect(page.nextPageId).toBeNull();
    });

    it('eligibility가 일부 항목을 회수해도 nextPageId는 마지막 raw 행 기준으로 유지된다(페이지 경계가 밀리지 않는다)', async () => {
      const pageSize = 2;
      const rawRows = [
        row({ id: 'a', publishedAt: new Date('2026-07-22T00:00:00.000Z') }),
        row({ id: 'b', publishedAt: new Date('2026-07-21T00:00:00.000Z') }),
        row({ id: 'c', publishedAt: new Date('2026-07-20T00:00:00.000Z') }),
      ];
      const listPage = jest.fn().mockResolvedValue(rawRows);
      // 'b'만 eligible — 'a'는 fence에 걸려 페이지에서 사라지지만 커서는 여전히 마지막 raw
      // 행('b')을 기준으로 계산돼야 한다(eligible 마지막 행이 아님).
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(new Set([rawRows[1]!.githubRepositoryId]));
      const { service } = serviceWith({
        listPage,
        filterEligibleRepositoryIds,
      });

      const page = await service.findPage(undefined, pageSize);

      expect(page.items.map((item) => item.id)).toEqual(['b']);
      expect(page.nextPageId).toBe(
        encodePublicProjectCursor({
          publishedAt: rawRows[1]!.publishedAt,
          id: rawRows[1]!.id,
        }),
      );
    });

    it('pageId가 주어지면 decode한 커서를 repository.listPage에 전달한다', async () => {
      const cursor = {
        publishedAt: new Date('2026-07-20T00:00:00.000Z'),
        id: 'synthetic-repository-1',
      };
      const pageId = encodePublicProjectCursor(cursor);
      const listPage = jest.fn().mockResolvedValue([]);
      const { service } = serviceWith({ listPage });

      await service.findPage(pageId, 10);

      expect(listPage).toHaveBeenCalledWith(cursor, 11);
    });

    it('잘못된 pageId는 INVALID_PAGE_ID DomainException을 던진다', async () => {
      const { service } = serviceWith({});

      await expect(service.findPage('not-a-valid-cursor', 10)).rejects.toThrow(
        DomainException,
      );
    });
  });

  describe('findDetail', () => {
    it('존재하지 않는 프로젝트는 PROJECT_NOT_FOUND 404를 던진다', async () => {
      const findById = jest.fn().mockResolvedValue(null);
      const { service } = serviceWith({ findById });

      await expect(service.findDetail('missing')).rejects.toMatchObject({
        errorCode: { code: 'PPJ_001', status: 404 },
      });
    });

    it('행은 있지만 eligibility fence에 막힌 프로젝트도 동일한 PROJECT_NOT_FOUND 404다', async () => {
      const found = row({ id: 'synthetic-repository-1' });
      const findById = jest.fn().mockResolvedValue(found);
      const isEligible = jest.fn().mockResolvedValue(false);
      const { service } = serviceWith({ findById, isEligible });

      await expect(
        service.findDetail('synthetic-repository-1'),
      ).rejects.toMatchObject({ errorCode: { code: 'PPJ_001', status: 404 } });
    });

    it('eligible한 프로젝트는 지표/기여자를 배치 조회(질의 2개, 병렬)해 기여자를 commitCount 내림차순으로 정렬한다', async () => {
      const found = row({
        id: 'synthetic-repository-1',
        githubRepositoryId: 9001n,
      });
      const findById = jest.fn().mockResolvedValue(found);
      const isEligible = jest.fn().mockResolvedValue(true);
      const metrics: CollectionRepositoryCumulativeMetricsDto[] = [
        {
          repositoryId: 9001n,
          dataAsOf: new Date('2026-07-30T00:00:00.000Z'),
          commitCount: 42,
          pullRequestCount: 7,
          releaseCount: 3,
        },
      ];
      const contributors: CollectionContributorCumulativeMetricsDto[] = [
        {
          repositoryId: 9001n,
          githubUserId: 1n,
          githubLogin: 'low-committer',
          dataAsOf: new Date('2026-07-30T00:00:00.000Z'),
          commitCount: 2,
          pullRequestCount: 0,
          releaseCount: 0,
        },
        {
          repositoryId: 9001n,
          githubUserId: 2n,
          githubLogin: 'high-committer',
          dataAsOf: new Date('2026-07-30T00:00:00.000Z'),
          commitCount: 40,
          pullRequestCount: 5,
          releaseCount: 1,
        },
      ];
      const getRepositoryCumulativeMetrics = jest
        .fn()
        .mockResolvedValue(metrics);
      const getContributorCumulativeMetrics = jest
        .fn()
        .mockResolvedValue(contributors);
      const { service } = serviceWith({
        findById,
        isEligible,
        getRepositoryCumulativeMetrics,
        getContributorCumulativeMetrics,
      });

      const detail = await service.findDetail('synthetic-repository-1');

      expect(getRepositoryCumulativeMetrics).toHaveBeenCalledWith({
        repositoryIds: [9001n],
      });
      expect(getContributorCumulativeMetrics).toHaveBeenCalledWith({
        repositoryIds: [9001n],
      });
      expect(detail.metrics).toEqual({
        commitCount: 42,
        pullRequestCount: 7,
        releaseCount: 3,
      });
      expect(detail.contributors.map((c) => c.githubLogin)).toEqual([
        'high-committer',
        'low-committer',
      ]);
    });

    it('지표 관측이 아직 없으면 0값으로 대체한다', async () => {
      const found = row({
        id: 'synthetic-repository-1',
        githubRepositoryId: 9001n,
      });
      const findById = jest.fn().mockResolvedValue(found);
      const isEligible = jest.fn().mockResolvedValue(true);
      const { service } = serviceWith({ findById, isEligible });

      const detail = await service.findDetail('synthetic-repository-1');

      expect(detail.metrics).toEqual({
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
      });
      expect(detail.contributors).toEqual([]);
    });
  });

  describe('findProfile', () => {
    const identity: PublicUserIdentity = {
      userId: 'synthetic-user-1',
      githubNickname: 'synthetic-login',
      avatarUrl: null,
    };

    it('존재하지 않는 사용자는 USER_PROFILE_NOT_FOUND 404를 던진다', async () => {
      const findUserIdentity = jest.fn().mockResolvedValue(null);
      const listForUser = jest.fn().mockResolvedValue([]);
      const { service } = serviceWith({ findUserIdentity, listForUser });

      await expect(service.findProfile('missing-user')).rejects.toMatchObject({
        errorCode: { code: 'PPJ_002', status: 404 },
      });
    });

    it('존재하지만 공개 가능한 프로젝트가 하나도 없는 사용자도 동일한 USER_PROFILE_NOT_FOUND 404다', async () => {
      const found = row({ id: 'synthetic-repository-1' });
      const findUserIdentity = jest.fn().mockResolvedValue(identity);
      const listForUser = jest.fn().mockResolvedValue([found]);
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(new Set());
      const { service } = serviceWith({
        findUserIdentity,
        listForUser,
        filterEligibleRepositoryIds,
      });

      await expect(
        service.findProfile('synthetic-user-1'),
      ).rejects.toMatchObject({ errorCode: { code: 'PPJ_002', status: 404 } });
    });

    it('신원 조회·후보 조회를 병렬로 호출하고 eligibility 배치 조회 1개를 더해 총 3개 질의로 고정된다', async () => {
      const found = row({ id: 'synthetic-repository-1' });
      const findUserIdentity = jest.fn().mockResolvedValue(identity);
      const listForUser = jest.fn().mockResolvedValue([found]);
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(new Set([found.githubRepositoryId]));
      const { service } = serviceWith({
        findUserIdentity,
        listForUser,
        filterEligibleRepositoryIds,
      });

      const profile = await service.findProfile('synthetic-user-1');

      expect(findUserIdentity).toHaveBeenCalledTimes(1);
      expect(listForUser).toHaveBeenCalledTimes(1);
      expect(filterEligibleRepositoryIds).toHaveBeenCalledTimes(1);
      expect(profile.identity).toEqual(identity);
      expect(profile.projects).toEqual([found]);
    });
  });
});
