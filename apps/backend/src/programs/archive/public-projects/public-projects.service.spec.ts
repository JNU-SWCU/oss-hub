import { DomainException } from '../../../common/error-code';
import type {
  ProgramContributorCumulativeMetrics,
  PublicProjectMetricsRepository,
  ProgramRepositoryCumulativeMetrics,
} from './repository/public-project-metrics.repository';
import type { PublicEligibilityService } from '../public-eligibility/public-eligibility.service';
import { loadRuntimeConfig } from '../../../runtime-config/runtime-config';
import {
  decodePublicProjectCursor,
  encodePublicProjectCursor,
  resolvePublicProjectCursorKey,
} from './public-project-cursor';
import type {
  PublicProjectRow,
  PublicUserIdentity,
} from './domain/public-project-record';
import type { PublicProjectsRepository } from './public-projects.repository';
import { PublicProjectsService } from './public-projects.service';

const SESSION_SECRET = Buffer.from(
  'synthetic-public-projects-service-secret-01',
).toString('base64url');
const CURSOR_KEY = resolvePublicProjectCursorKey({ SESSION_SECRET });

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
  const githubRepositoryId =
    overrides.githubRepositoryId ?? githubRepositoryIdFor(overrides.id);
  return {
    projectId: githubRepositoryId.toString(),
    githubRepositoryId,
    repositoryName: `repo-${overrides.id}`,
    githubUrl: `https://github.com/synthetic-org/${overrides.id}`,
    publishedAt: new Date('2026-07-20T00:00:00.000Z'),
    programId: 'synthetic-program-1',
    programName: 'synthetic-program',
    trackType: 'EXTRACURRICULAR',
    teamName: null,
    teamMemberCount: 1,
    applicantNickname: 'synthetic-applicant',
    ...overrides,
  };
}

function serviceWith(overrides: {
  listPage?: jest.Mock;
  listYears?: jest.Mock;
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
    listYears: overrides.listYears ?? jest.fn().mockResolvedValue([]),
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
    getRepositoryCumulativeMetrics:
      overrides.getRepositoryCumulativeMetrics ??
      jest.fn().mockResolvedValue([]),
    getContributorCumulativeMetrics:
      overrides.getContributorCumulativeMetrics ??
      jest.fn().mockResolvedValue([]),
  } as unknown as PublicProjectMetricsRepository;
  const service = new PublicProjectsService(
    repository,
    eligibility,
    collection,
    loadRuntimeConfig({ SESSION_SECRET }),
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
      const rawRows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })];
      const listPage = jest.fn().mockResolvedValue(rawRows);
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(new Set(rawRows.map((r) => r.githubRepositoryId)));
      const { service } = serviceWith({
        listPage,
        filterEligibleRepositoryIds,
      });

      const page = await service.findPage(undefined, pageSize);

      expect(listPage).toHaveBeenCalledWith(null, pageSize + 1, undefined);
      expect(page.items).toHaveLength(2);
      expect(page.items.map((item) => item.id)).toEqual(['a', 'b']);
      expect(page.nextPageId).not.toBeNull();
    });

    it('year를 repository.listPage에 전달한다', async () => {
      const listPage = jest.fn().mockResolvedValue([]);
      const { service } = serviceWith({ listPage });

      await service.findPage(undefined, 12, 2026);

      expect(listPage).toHaveBeenCalledWith(null, 13, 2026);
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

      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(new Set([rawRows[1]!.githubRepositoryId]));
      const { service } = serviceWith({
        listPage,
        filterEligibleRepositoryIds,
      });

      const page = await service.findPage(undefined, pageSize);

      expect(page.items.map((item) => item.id)).toEqual(['b']);

      expect(page.nextPageId).not.toBeNull();
      expect(decodePublicProjectCursor(page.nextPageId!, CURSOR_KEY)).toEqual({
        publishedAt: rawRows[1]!.publishedAt,
        id: rawRows[1]!.id,
      });
    });

    it('pageId가 주어지면 decode한 커서를 repository.listPage에 전달한다', async () => {
      const cursor = {
        publishedAt: new Date('2026-07-20T00:00:00.000Z'),
        id: 'synthetic-repository-1',
      };
      const pageId = encodePublicProjectCursor(cursor, CURSOR_KEY);
      const listPage = jest.fn().mockResolvedValue([]);
      const { service } = serviceWith({ listPage });

      await service.findPage(pageId, 10);

      expect(listPage).toHaveBeenCalledWith(cursor, 11, undefined);
    });

    it('잘못된 pageId는 INVALID_PAGE_ID DomainException을 던진다', async () => {
      const { service } = serviceWith({});

      await expect(service.findPage('not-a-valid-cursor', 10)).rejects.toThrow(
        DomainException,
      );
    });
  });

  describe('QA40 — 커서를 통한 숨겨진 저장소 노출', () => {
    const HIDDEN = row({
      id: 'seed:hidden-repository-internal-cuid',
      githubRepositoryId: 9401n,
      publishedAt: new Date('2026-07-21T09:30:00.000Z'),
    });
    const VISIBLE = row({
      id: 'visible-repository-cuid',
      githubRepositoryId: 9400n,
      publishedAt: new Date('2026-07-22T00:00:00.000Z'),
    });
    const TAIL = row({
      id: 'tail-repository-cuid',
      githubRepositoryId: 9402n,
      publishedAt: new Date('2026-07-20T00:00:00.000Z'),
    });

    function pageWithHiddenBoundary() {
      const rawRows = [VISIBLE, HIDDEN, TAIL];
      const listPage = jest.fn().mockResolvedValue(rawRows);
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(new Set([VISIBLE.githubRepositoryId]));
      return serviceWith({ listPage, filterEligibleRepositoryIds });
    }

    it('①(고침) 페이지 경계가 가려진 저장소여도 커서에서 내부 id·공개 시각을 복원할 수 없다', async () => {
      const { service } = pageWithHiddenBoundary();

      const page = await service.findPage(undefined, 2);

      expect(page.items.map((item) => item.id)).toEqual([VISIBLE.id]);
      expect(page.nextPageId).not.toBeNull();

      const token = Buffer.from(page.nextPageId!, 'base64url');
      expect(token.toString('utf8')).not.toContain(HIDDEN.id);
      expect(token.toString('latin1')).not.toContain(HIDDEN.id);
      expect(token.toString('utf8')).not.toContain(
        HIDDEN.publishedAt.toISOString(),
      );

      expect(() => {
        JSON.parse(token.toString('utf8'));
      }).toThrow();
    });

    it('①(고침) 그래도 페이지 경계는 그대로다 — 서버 키로 열면 마지막 raw 행이 나온다', async () => {
      const { service } = pageWithHiddenBoundary();

      const page = await service.findPage(undefined, 2);

      expect(decodePublicProjectCursor(page.nextPageId!, CURSOR_KEY)).toEqual({
        publishedAt: HIDDEN.publishedAt,
        id: HIDDEN.id,
      });
    });

    it('①(고침) 다른 서버 키로는 커서를 재사용할 수 없다 — INVALID_PAGE_ID다', async () => {
      const { service } = pageWithHiddenBoundary();
      const page = await service.findPage(undefined, 2);

      const foreign = new PublicProjectsService(
        {
          listPage: jest.fn().mockResolvedValue([]),
        } as unknown as PublicProjectsRepository,
        {
          filterEligibleRepositoryIds: jest.fn().mockResolvedValue(new Set()),
        } as unknown as PublicEligibilityService,
        {} as unknown as PublicProjectMetricsRepository,
        loadRuntimeConfig({
          SESSION_SECRET: Buffer.from(
            'synthetic-public-projects-other-secret-01',
          ).toString('base64url'),
        }),
      );

      await expect(foreign.findPage(page.nextPageId!, 2)).rejects.toThrow(
        DomainException,
      );
    });

    it('②(미해결) pageSize=1에서 그 행이 fence에 걸리면 items는 비고 nextPageId는 남는다', async () => {
      const listPage = jest.fn().mockResolvedValue([HIDDEN, TAIL]);
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(new Set<bigint>());
      const { service } = serviceWith({
        listPage,
        filterEligibleRepositoryIds,
      });

      const page = await service.findPage(undefined, 1);

      expect(page.items).toHaveLength(0);
      expect(page.nextPageId).not.toBeNull();
    });

    it('②(미해결) 일반형 — 꽉 찬 창에서 items가 모자란 만큼이 곧 가려진 건수다', async () => {
      const listPage = jest
        .fn()
        .mockResolvedValue([VISIBLE, HIDDEN, TAIL, row({ id: 'lookahead' })]);
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(
          new Set([VISIBLE.githubRepositoryId, TAIL.githubRepositoryId]),
        );
      const { service } = serviceWith({
        listPage,
        filterEligibleRepositoryIds,
      });

      const page = await service.findPage(undefined, 3);

      expect(page.nextPageId).not.toBeNull();
      expect(3 - page.items.length).toBe(1);
    });
  });

  describe('listYears', () => {
    it('repository.listYears에 위임한다', async () => {
      const listYears = jest.fn().mockResolvedValue([2026, 2025]);
      const { service } = serviceWith({ listYears });

      await expect(service.listYears()).resolves.toEqual([2026, 2025]);
      expect(listYears).toHaveBeenCalledTimes(1);
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
      const metrics: ProgramRepositoryCumulativeMetrics[] = [
        {
          repositoryId: 9001n,
          dataAsOf: new Date('2026-07-30T00:00:00.000Z'),
          hasCollectedData: true,
          commitCount: 42,
          pullRequestCount: 7,
          releaseCount: 3,
        },
      ];
      const contributors: ProgramContributorCumulativeMetrics[] = [
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
      githubId: 501n,
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

    it('신원 조회·후보 조회를 병렬로 호출하고 eligibility 배치 조회 1개 + 지표/기여자 배치 조회 2개(병렬)를 더해 총 5개 질의로 고정된다', async () => {
      const found = row({ id: 'synthetic-repository-1' });
      const findUserIdentity = jest.fn().mockResolvedValue(identity);
      const listForUser = jest.fn().mockResolvedValue([found]);
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(new Set([found.githubRepositoryId]));
      const getRepositoryCumulativeMetrics = jest.fn().mockResolvedValue([]);
      const getContributorCumulativeMetrics = jest.fn().mockResolvedValue([]);
      const { service } = serviceWith({
        findUserIdentity,
        listForUser,
        filterEligibleRepositoryIds,
        getRepositoryCumulativeMetrics,
        getContributorCumulativeMetrics,
      });

      const profile = await service.findProfile('synthetic-user-1');

      expect(findUserIdentity).toHaveBeenCalledTimes(1);
      expect(listForUser).toHaveBeenCalledTimes(1);
      expect(filterEligibleRepositoryIds).toHaveBeenCalledTimes(1);
      expect(getRepositoryCumulativeMetrics).toHaveBeenCalledWith({
        repositoryIds: [found.githubRepositoryId],
      });
      expect(getContributorCumulativeMetrics).toHaveBeenCalledWith({
        repositoryIds: [found.githubRepositoryId],
      });
      expect(profile.identity).toEqual(identity);

      expect(profile.projects).toEqual([
        {
          row: found,
          observed: false,
          hasCollectedData: false,
          dataAsOf: null,
          metrics: null,
        },
      ]);
      expect(profile.observedTotals).toEqual({
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
      });
    });

    it('두 프로젝트의 기여를 정확히 합산하고, 다른 기여자의 활동은 섞이지 않는다', async () => {
      const projectA = row({
        id: 'synthetic-repository-a',
        githubRepositoryId: 9101n,
      });
      const projectB = row({
        id: 'synthetic-repository-b',
        githubRepositoryId: 9102n,
      });
      const findUserIdentity = jest.fn().mockResolvedValue(identity);
      const listForUser = jest.fn().mockResolvedValue([projectA, projectB]);
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(
          new Set([projectA.githubRepositoryId, projectB.githubRepositoryId]),
        );
      const dataAsOfA = new Date('2026-07-28T00:00:00.000Z');
      const dataAsOfB = new Date('2026-07-29T00:00:00.000Z');
      const getRepositoryCumulativeMetrics = jest.fn().mockResolvedValue([
        {
          repositoryId: 9101n,
          dataAsOf: dataAsOfA,
          hasCollectedData: true,
          commitCount: 999,
          pullRequestCount: 999,
          releaseCount: 999,
        },
        {
          repositoryId: 9102n,
          dataAsOf: dataAsOfB,
          hasCollectedData: true,
          commitCount: 999,
          pullRequestCount: 999,
          releaseCount: 999,
        },
      ]);

      const getContributorCumulativeMetrics = jest.fn().mockResolvedValue([
        {
          repositoryId: 9101n,
          githubUserId: 999n,
          githubLogin: 'someone-else',
          dataAsOf: dataAsOfA,
          commitCount: 900,
          pullRequestCount: 900,
          releaseCount: 900,
        },
        {
          repositoryId: 9101n,
          githubUserId: 501n,
          githubLogin: 'synthetic-login',
          dataAsOf: dataAsOfA,
          commitCount: 5,
          pullRequestCount: 1,
          releaseCount: 0,
        },
        {
          repositoryId: 9102n,
          githubUserId: 501n,
          githubLogin: 'synthetic-login',
          dataAsOf: dataAsOfB,
          commitCount: 3,
          pullRequestCount: 2,
          releaseCount: 1,
        },
      ]);
      const { service } = serviceWith({
        findUserIdentity,
        listForUser,
        filterEligibleRepositoryIds,
        getRepositoryCumulativeMetrics,
        getContributorCumulativeMetrics,
      });

      const profile = await service.findProfile('synthetic-user-1');

      expect(profile.projects).toEqual([
        {
          row: projectA,
          observed: true,
          hasCollectedData: true,
          dataAsOf: dataAsOfA,
          metrics: { commitCount: 5, pullRequestCount: 1, releaseCount: 0 },
        },
        {
          row: projectB,
          observed: true,
          hasCollectedData: true,
          dataAsOf: dataAsOfB,
          metrics: { commitCount: 3, pullRequestCount: 2, releaseCount: 1 },
        },
      ]);
      expect(profile.observedTotals).toEqual({
        commitCount: 8,
        pullRequestCount: 3,
        releaseCount: 1,
      });
    });

    it('관측됐지만 이 사용자의 기여가 없는 project는 0값 metrics로, 아직 관측되지 않은 project는 metrics null로 구분한다', async () => {
      const observedZero = row({
        id: 'synthetic-repository-zero',
        githubRepositoryId: 9201n,
      });
      const unobserved = row({
        id: 'synthetic-repository-unobserved',
        githubRepositoryId: 9202n,
      });
      const findUserIdentity = jest.fn().mockResolvedValue(identity);
      const listForUser = jest
        .fn()
        .mockResolvedValue([observedZero, unobserved]);
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(
          new Set([
            observedZero.githubRepositoryId,
            unobserved.githubRepositoryId,
          ]),
        );
      const dataAsOf = new Date('2026-07-30T00:00:00.000Z');
      const getRepositoryCumulativeMetrics = jest.fn().mockResolvedValue([
        {
          repositoryId: 9201n,
          dataAsOf,
          hasCollectedData: true,
          commitCount: 0,
          pullRequestCount: 0,
          releaseCount: 0,
        },
      ]);

      const getContributorCumulativeMetrics = jest.fn().mockResolvedValue([]);
      const { service } = serviceWith({
        findUserIdentity,
        listForUser,
        filterEligibleRepositoryIds,
        getRepositoryCumulativeMetrics,
        getContributorCumulativeMetrics,
      });

      const profile = await service.findProfile('synthetic-user-1');

      expect(profile.projects).toEqual([
        {
          row: observedZero,
          observed: true,
          hasCollectedData: true,
          dataAsOf,
          metrics: { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
        },
        {
          row: unobserved,
          observed: false,
          hasCollectedData: false,
          dataAsOf: null,
          metrics: null,
        },
      ]);
      expect(profile.observedTotals).toEqual({
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
      });
    });

    it('#893: presence는 PRESENT라 observed:true지만 첫 sweep 전이라 hasCollectedData:false인 project를 그대로 전달한다', async () => {
      const preSweep = row({
        id: 'synthetic-repository-pre-sweep',
        githubRepositoryId: 9301n,
      });
      const findUserIdentity = jest.fn().mockResolvedValue(identity);
      const listForUser = jest.fn().mockResolvedValue([preSweep]);
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(new Set([preSweep.githubRepositoryId]));
      const dataAsOf = new Date('2026-08-12T00:00:00.000Z');

      const getRepositoryCumulativeMetrics = jest.fn().mockResolvedValue([
        {
          repositoryId: 9301n,
          dataAsOf,
          hasCollectedData: false,
          commitCount: 0,
          pullRequestCount: 0,
          releaseCount: 0,
        },
      ]);
      const getContributorCumulativeMetrics = jest.fn().mockResolvedValue([]);
      const { service } = serviceWith({
        findUserIdentity,
        listForUser,
        filterEligibleRepositoryIds,
        getRepositoryCumulativeMetrics,
        getContributorCumulativeMetrics,
      });

      const profile = await service.findProfile('synthetic-user-1');

      expect(profile.projects).toEqual([
        {
          row: preSweep,
          observed: true,
          hasCollectedData: false,
          dataAsOf,
          metrics: { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
        },
      ]);
    });
  });
});
