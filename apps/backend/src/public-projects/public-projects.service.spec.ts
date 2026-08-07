import type {
  CollectionContributorCumulativeMetricsDto,
  CollectionReadPort,
  CollectionRepositoryCumulativeMetricsDto,
} from '../collection/collection-read.port';
import { DomainException } from '../common/error-code';
import type { PublicEligibilityService } from '../public-eligibility/public-eligibility.service';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import {
  decodePublicProjectCursor,
  encodePublicProjectCursor,
  resolvePublicProjectCursorKey,
} from './public-project-cursor';
import type {
  PublicProjectRow,
  PublicProjectsRepository,
  PublicUserIdentity,
} from './public-projects.repository';
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
    category: 'BASIC',
    teamName: null,
    teamMemberCount: 1,
    applicantNickname: 'synthetic-applicant',
    ...overrides,
  };
}

function serviceWith(overrides: {
  listPage?: jest.Mock;
  countByCategory?: jest.Mock;
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
    countByCategory:
      overrides.countByCategory ?? jest.fn().mockResolvedValue([]),
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
    listPublicRankingYears: jest.fn(),
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

      expect(listPage).toHaveBeenCalledWith(null, pageSize + 1, undefined);
      expect(page.items).toHaveLength(2);
      expect(page.items.map((item) => item.id)).toEqual(['a', 'b']);
      expect(page.nextPageId).not.toBeNull();
    });

    it('category를 repository.listPage에 전달한다', async () => {
      const listPage = jest.fn().mockResolvedValue([]);
      const { service } = serviceWith({ listPage });

      await service.findPage(undefined, 12, 'CAPSTONE');

      expect(listPage).toHaveBeenCalledWith(null, 13, 'CAPSTONE');
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
      // QA40 이후 토큰은 서버 키로만 열리는 불투명 값이라 문자열 동등 비교가 성립하지 않는다
      // (매번 IV가 다르다). 이 테스트가 지키려는 것은 토큰의 표기가 아니라 **경계 규칙**이므로
      // 서버 키로 복호해 「마지막 raw 행」인지만 확인한다.
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

  /**
   * QA40 — 「공개 응답으로 숨겨진 저장소의 존재를 유추할 수 있다」의 부작용 두 가지.
   * ①(커서 복원)은 여기서 막는다. ②(빈 페이지 오라클)는 `findPage = 상수 2 질의` 설계와
   * 정면으로 부딪혀 막지 못했고, 아래 마지막 두 테스트가 **남아 있는 누출을 명시적으로 고정**한다
   * — 그린이라고 해서 해결됐다는 뜻이 아니다.
   */
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
      // 평문 base64url(JSON) 커서였다면 여기서 `{p, i}`가 그대로 나왔다.
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
        {} as unknown as CollectionReadPort,
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

    /**
     * ② 미해결. `pageSize=1`로 훑으면 「items는 비었는데 nextPageId는 있다」가 그대로
     * 관측되고, 이는 그 keyset 구간에 가려진 저장소가 정확히 1건 있다는 뜻이다.
     * 막으려면 페이지가 찰 때까지 재조회해야 하는데 그것은 `public-projects/AGENTS.md`의
     * 「findPage: 2 쿼리」·「반복문 안 쿼리 금지」와 부딪힌다. 이 테스트는 **현재 동작을
     * 고정**해, 나중에 누가 페이지 채우기를 도입하면 여기서 걸려 의도적으로 갱신하게 한다.
     */
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

    /**
     * ②의 일반형 — `pageSize=1`만의 문제가 아니다. 어떤 pageSize에서도
     * `items.length < pageSize && nextPageId !== null`이면 그 구간의 가려진 건수가
     * 정확히 `pageSize - items.length`다. ②를 「빈 페이지」로만 좁혀 보면 안 된다.
     */
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

  describe('categoryCounts', () => {
    it('없는 분류는 0으로 채우고 all은 합계다', async () => {
      const countByCategory = jest.fn().mockResolvedValue([
        { category: 'BASIC', count: 2 },
        { category: 'CAPSTONE', count: 1 },
      ]);
      const { service } = serviceWith({ countByCategory });

      await expect(service.categoryCounts()).resolves.toEqual({
        all: 3,
        BASIC: 2,
        SW_VALUE_SPREAD: 0,
        OSS_CONTEST: 0,
        CAPSTONE: 1,
        SW_CONVERGENCE: 0,
        GLOBAL_MAKERTHON: 0,
        CORPORATE_INTERNSHIP: 0,
      });
    });

    it('eligibility fence를 호출하지 않고 repository.countByCategory만 사용한다', async () => {
      const countByCategory = jest
        .fn()
        .mockResolvedValue([{ category: 'BASIC', count: 1 }]);
      const filterEligibleRepositoryIds = jest.fn();
      const isEligible = jest.fn();
      const { service } = serviceWith({
        countByCategory,
        filterEligibleRepositoryIds,
        isEligible,
      });

      await service.categoryCounts();

      expect(countByCategory).toHaveBeenCalledTimes(1);
      expect(filterEligibleRepositoryIds).not.toHaveBeenCalled();
      expect(isEligible).not.toHaveBeenCalled();
    });
  });

  /**
   * 의도된 trade-off: 아카이브 뱃지(categoryCounts)는 플랫폼 공개 base 카운트만 세고
   * Collection eligibility fence를 적용하지 않는다. 목록(findPage)은 fence를 적용한다.
   * 따라서 badge 숫자와 list 길이가 어긋날 수 있다 — 뱃지 = published platform-public 수,
   * 목록 = fence 통과 후 크기.
   */
  describe('categoryCounts vs findPage — eligibility fence 의도적 차이', () => {
    it('목록에서 fence가 일부를 걸러도 counts는 원본 countByCategory 값을 유지한다', async () => {
      const rawRows = [
        row({
          id: 'capstone-a',
          category: 'CAPSTONE',
          githubRepositoryId: 9101n,
        }),
        row({
          id: 'capstone-b',
          category: 'CAPSTONE',
          githubRepositoryId: 9102n,
        }),
      ];
      const listPage = jest.fn().mockResolvedValue(rawRows);
      // fence가 한 건만 통과 — 목록 items 길이는 1이 된다.
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(new Set([rawRows[0]!.githubRepositoryId]));
      // counts 경로는 fence 없이 CAPSTONE: 2 를 그대로 반환한다.
      const countByCategory = jest
        .fn()
        .mockResolvedValue([{ category: 'CAPSTONE', count: 2 }]);
      const { service } = serviceWith({
        listPage,
        filterEligibleRepositoryIds,
        countByCategory,
      });

      const counts = await service.categoryCounts();
      const page = await service.findPage(undefined, 20, 'CAPSTONE');

      // badge = published platform-public count (post-fence list size 가 아님)
      expect(counts.CAPSTONE).toBe(2);
      expect(counts.all).toBe(2);
      expect(page.items).toHaveLength(1);
      expect(page.items.map((item) => item.id)).toEqual(['capstone-a']);
      expect(filterEligibleRepositoryIds).toHaveBeenCalledTimes(1);
      expect(countByCategory).toHaveBeenCalledTimes(1);
    });

    it('findPage는 fence로 탈락한 행을 빼고, categoryCounts는 탈락 여부와 무관하게 repository 집계를 반환한다', async () => {
      const publishedPublic = [
        row({
          id: 'eligible-repo',
          category: 'BASIC',
          githubRepositoryId: 9201n,
        }),
        row({
          id: 'fence-dropped-repo',
          category: 'BASIC',
          githubRepositoryId: 9202n,
        }),
        row({
          id: 'another-fence-drop',
          category: 'OSS_CONTEST',
          githubRepositoryId: 9203n,
        }),
      ];
      const listPage = jest.fn().mockResolvedValue(publishedPublic);
      const filterEligibleRepositoryIds = jest
        .fn()
        .mockResolvedValue(new Set([publishedPublic[0]!.githubRepositoryId]));
      const countByCategory = jest.fn().mockResolvedValue([
        { category: 'BASIC', count: 2 },
        { category: 'OSS_CONTEST', count: 1 },
      ]);
      const { service } = serviceWith({
        listPage,
        filterEligibleRepositoryIds,
        countByCategory,
      });

      const page = await service.findPage(undefined, 20);
      const counts = await service.categoryCounts();

      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.id).toBe('eligible-repo');
      expect(counts).toEqual({
        all: 3,
        BASIC: 2,
        SW_VALUE_SPREAD: 0,
        OSS_CONTEST: 1,
        CAPSTONE: 0,
        SW_CONVERGENCE: 0,
        GLOBAL_MAKERTHON: 0,
        CORPORATE_INTERNSHIP: 0,
      });
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
      // 아직 collection이 이 저장소를 관측하지 않았다 — 미관측(observed=false)이다.
      expect(profile.projects).toEqual([
        { row: found, observed: false, dataAsOf: null, metrics: null },
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
          commitCount: 999,
          pullRequestCount: 999,
          releaseCount: 999,
        },
        {
          repositoryId: 9102n,
          dataAsOf: dataAsOfB,
          commitCount: 999,
          pullRequestCount: 999,
          releaseCount: 999,
        },
      ]);
      // repositoryId 9101의 다른 기여자(githubUserId 999n)는 이 사용자(501n)의 합계에
      // 절대 섞이지 않아야 한다 — repository 전체 합계(999)와 달리 이 사용자만의 기여만
      // 카운트돼야 한다.
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
          dataAsOf: dataAsOfA,
          metrics: { commitCount: 5, pullRequestCount: 1, releaseCount: 0 },
        },
        {
          row: projectB,
          observed: true,
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
          commitCount: 0,
          pullRequestCount: 0,
          releaseCount: 0,
        },
      ]);
      // 이 사용자의 기여자 행이 없다(다른 사람만 기여했거나 아직 이 사용자 기여가 없다).
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
          dataAsOf,
          metrics: { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
        },
        { row: unobserved, observed: false, dataAsOf: null, metrics: null },
      ]);
      expect(profile.observedTotals).toEqual({
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
      });
    });
  });
});
