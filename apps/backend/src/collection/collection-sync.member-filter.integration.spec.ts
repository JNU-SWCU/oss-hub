import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionIncrementalRepository } from './collection-incremental.repository';
import { CollectionSyncService } from './collection-sync.service';
import { ProviderRequestQueue } from './collection-provider-queue';
import type {
  CollectionAppClient,
  CollectionPullRequest,
  CollectionRelease,
  CollectionRepository as ProviderRepository,
} from './collection-app.client';
import type { CollectionAppTokenProvider } from './collection-app.token';
import type { RequestFingerprint } from './collection-app.frontier';

/**
 * ADR-009 «PR·릴리스는 적재 시 거른다»(#680)를 **실 Postgres**에 대해 확인한다.
 *
 * 단위 테스트(`collection-sync.service.spec.ts`)는 in-memory Prisma double 위에서 돈다.
 * 여기서만 확인할 수 있는 것은 세 가지다 —
 *   1. 필터의 기준이 되는 팀원 목록이 실제 스키마의 조인
 *      (`GithubRepository.githubRepositoryId` → `Repository.teamId` → `TeamMember` → `User`)으로
 *      제대로 풀리는가,
 *   2. 거른 항목이 진짜로 `CollectionPullRequestFact`/`CollectionReleaseFact` **테이블에** 없는가,
 *   3. 그 결과 `CollectionContributorYearAggregate`에 비팀원 행이 생기지 않는가.
 *
 * provider는 stub이다 — 이 suite가 재는 것은 HTTP 계층이 아니라 적재 경계다.
 */

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const APP_ID = 9_000_000_680_001n;
const ORG_LOGIN = 'synthetic-member-filter-org';
const GITHUB_ORGANIZATION_ID = 9_000_000_680_002n;
const GITHUB_REPOSITORY_ID = 9_000_000_680_003n;
const OWNER_ID = 'synthetic-member-filter-suite';

const MEMBER_GITHUB_ID = 9_000_000_680_101n;
const LATE_MEMBER_GITHUB_ID = 9_000_000_680_103n;
const OUTSIDER_GITHUB_ID = '9000000680102';

const SEED_PREFIX = 'synthetic-member-filter';
const PROGRAM_ID = `${SEED_PREFIX}-program`;
const TEAM_ID = `${SEED_PREFIX}-team`;
const MEMBER_USER_ID = `${SEED_PREFIX}-user`;
const LATE_MEMBER_USER_ID = `${SEED_PREFIX}-late-user`;
const APPLICATION_ID = `${SEED_PREFIX}-application`;
const REPOSITORY_ID = `${SEED_PREFIX}-repository`;

const fingerprint = (endpoint: string): RequestFingerprint => ({
  endpoint,
  ref: null,
  query: 'state=all',
  order: null,
  pageSize: 100,
  accept: 'application/vnd.github+json',
  apiVersion: '2022-11-28',
});

const providerRepository = (): ProviderRepository => ({
  id: GITHUB_REPOSITORY_ID.toString(),
  name: 'member-filter-repo',
  fullName: `${ORG_LOGIN}/member-filter-repo`,
  private: false,
  archived: false,
  defaultBranch: 'main',
  ownerLogin: ORG_LOGIN,
  htmlUrl: `https://example.invalid/${ORG_LOGIN}/member-filter-repo`,
  updatedAt: '2026-08-01T00:00:00.000Z',
});

const pullRequest = (
  overrides: Partial<CollectionPullRequest>,
): CollectionPullRequest => ({
  id: '9000000680201',
  number: 1,
  state: 'open',
  draft: false,
  mergedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  authorLogin: 'synthetic-member',
  authorGithubId: MEMBER_GITHUB_ID.toString(),
  htmlUrl: 'https://example.invalid/pull/1',
  ...overrides,
});

const release = (overrides: Partial<CollectionRelease>): CollectionRelease => ({
  id: '9000000680301',
  tagName: 'v1.0.0',
  name: 'v1.0.0',
  publishedAt: '2026-08-01T00:00:00.000Z',
  authorLogin: 'synthetic-member',
  authorGithubId: MEMBER_GITHUB_ID.toString(),
  htmlUrl: 'https://example.invalid/releases/v1.0.0',
  ...overrides,
});

/**
 * 실제 GraphQL/REST 호출 없이 세 stream의 provider 응답만 고정한다. 커밋 축은 어느 경로로
 * 가든 0건으로 두어(팀이 있으면 author-scoped, 없으면 저장소 전량 REST) 이 suite가 PR·릴리스
 * 축만 재게 한다.
 */
const createClient = (
  pullRequests: readonly CollectionPullRequest[],
  releases: readonly CollectionRelease[],
): CollectionAppClient =>
  ({
    listInstallationRepositories: () => Promise.resolve([providerRepository()]),
    resolveUserNodeId: (login: string) => Promise.resolve(`node:${login}`),
    listDefaultBranchCommitsByAuthor: () => Promise.resolve([]),
    countDefaultBranchCommits: () => Promise.resolve(null),
    probeDefaultBranchHead: () =>
      Promise.resolve({
        changed: true as const,
        headSha: null,
        fingerprint: fingerprint('/repos/o/r/commits'),
        etag: null,
      }),
    listCommitsUntilKnownSha: () =>
      Promise.resolve({
        commits: [],
        disconnectedFullScan: true,
        fingerprint: fingerprint('/repos/o/r/commits'),
      }),
    listNewPullRequests: () =>
      Promise.resolve({
        pullRequests: [...pullRequests],
        newFrontier: pullRequests[0]
          ? { createdAt: pullRequests[0].createdAt, id: pullRequests[0].id }
          : null,
        fingerprint: fingerprint('/repos/o/r/pulls'),
      }),
    probeLatestRelease: () =>
      Promise.resolve({
        changed: true as const,
        frontier: { probe: 'synthetic-release-probe' },
        fingerprint: fingerprint('/repos/o/r/releases'),
        etag: 'synthetic-release-etag',
      }),
    listChangedPublishedReleases: () =>
      Promise.resolve({
        releases: [...releases],
        fingerprint: fingerprint('/repos/o/r/releases'),
      }),
  }) as unknown as CollectionAppClient;

describe('CollectionSyncService — PR·릴리스 멤버 필터 (실 DB)', () => {
  const prisma = new PrismaService();

  const createService = (client: CollectionAppClient): CollectionSyncService =>
    new CollectionSyncService(
      new CollectionIncrementalRepository(prisma),
      () => ({
        appId: APP_ID.toString(),
        organizationLogin: ORG_LOGIN,
        tokens: {} as CollectionAppTokenProvider,
        client,
        queue: new ProviderRequestQueue(),
      }),
      () => Promise.resolve(GITHUB_ORGANIZATION_ID),
      () => new Date('2026-08-01T12:00:00.000Z'),
      () => 'synthetic-member-filter-run',
    );

  /**
   * 팀을 특정할 수 있는 저장소를 만들려면 `GithubRepository`(수집 측)와 `Repository`(#449
   * 신청 산출물)가 같은 `githubRepositoryId`로 이어져야 하고, `Repository`가 팀을 가리켜야
   * 한다. 그래서 Program → User → Team → TeamMember → Application → Repository까지 전부 필요하다.
   */
  const seed = async (): Promise<void> => {
    await prisma.program.create({
      data: {
        id: PROGRAM_ID,
        name: 'synthetic member filter program',
        organizer: 'synthetic',
        category: 'BASIC',
        applicationTemplateKey: 'synthetic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
        description: 'synthetic',
      },
    });
    await prisma.user.create({
      data: {
        id: MEMBER_USER_ID,
        githubId: MEMBER_GITHUB_ID,
        nickname: 'synthetic-member',
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        programId: PROGRAM_ID,
        name: 'synthetic member filter team',
        joinCodeDigest: `${SEED_PREFIX}-join-code-digest`,
        leaderId: MEMBER_USER_ID,
      },
    });
    await prisma.teamMember.create({
      data: {
        teamId: TEAM_ID,
        programId: PROGRAM_ID,
        userId: MEMBER_USER_ID,
      },
    });
    await prisma.application.create({
      data: {
        id: APPLICATION_ID,
        programId: PROGRAM_ID,
        applicantId: MEMBER_USER_ID,
        teamId: TEAM_ID,
        answers: {},
        applicationTemplateVersion: 1,
        status: 'APPROVED',
      },
    });
    await prisma.repository.create({
      data: {
        id: REPOSITORY_ID,
        applicationId: APPLICATION_ID,
        programId: PROGRAM_ID,
        teamId: TEAM_ID,
        githubRepositoryId: GITHUB_REPOSITORY_ID,
        name: 'member-filter-repo',
        url: `https://github.com/${ORG_LOGIN}/member-filter-repo`,
      },
    });
  };

  beforeAll(() => prisma.$connect(), 60_000);

  afterEach(async () => {
    // GithubRepository → fact/aggregate/stream은 onDelete: Cascade라 부모 한 줄이면 지워진다.
    await prisma.githubRepository.deleteMany({
      where: { githubRepositoryId: GITHUB_REPOSITORY_ID },
    });
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CollectionSyncCursor" WHERE "appId" = $1',
      APP_ID,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CollectionSyncLease" WHERE "appId" = $1',
      APP_ID,
    );
    await prisma.repository.deleteMany({ where: { id: REPOSITORY_ID } });
    await prisma.application.deleteMany({ where: { id: APPLICATION_ID } });
    await prisma.teamMember.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [MEMBER_USER_ID, LATE_MEMBER_USER_ID] } },
    });
    await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
  });

  afterAll(() => prisma.$disconnect());

  it('팀원 PR·릴리스만 테이블에 남기고 비팀원·작성자 불명은 fact도 집계도 만들지 않는다', async () => {
    await seed();
    const client = createClient(
      [
        pullRequest({
          id: '9000000680202',
          createdAt: '2026-08-03T00:00:00.000Z',
          authorLogin: 'synthetic-outsider',
          authorGithubId: OUTSIDER_GITHUB_ID,
        }),
        pullRequest({
          id: '9000000680203',
          createdAt: '2026-08-02T00:00:00.000Z',
          authorLogin: null,
          authorGithubId: null,
        }),
        pullRequest({ id: '9000000680201' }),
      ],
      [
        release({
          id: '9000000680302',
          authorLogin: 'synthetic-outsider',
          authorGithubId: OUTSIDER_GITHUB_ID,
        }),
        release({ id: '9000000680301' }),
      ],
    );

    const result = await createService(client).run(OWNER_ID);
    expect(result.status).toBe('COMPLETED');

    const collected = await prisma.githubRepository.findUniqueOrThrow({
      where: { githubRepositoryId: GITHUB_REPOSITORY_ID },
      select: { id: true },
    });

    const pullRequestFacts = await prisma.collectionPullRequestFact.findMany({
      where: { repositoryId: collected.id },
      select: { githubPullRequestId: true, authorGithubId: true },
    });
    expect(pullRequestFacts).toHaveLength(1);
    expect(pullRequestFacts[0]?.githubPullRequestId).toBe(9_000_000_680_201n);
    expect(pullRequestFacts[0]?.authorGithubId).toBe(MEMBER_GITHUB_ID);

    const releaseFacts = await prisma.collectionReleaseFact.findMany({
      where: { repositoryId: collected.id },
      select: { githubReleaseId: true, authorGithubId: true },
    });
    expect(releaseFacts).toHaveLength(1);
    expect(releaseFacts[0]?.githubReleaseId).toBe(9_000_000_680_301n);
    expect(releaseFacts[0]?.authorGithubId).toBe(MEMBER_GITHUB_ID);

    // 비팀원 id로 조회하면 어느 테이블에도 행이 없다.
    await expect(
      prisma.collectionPullRequestFact.count({
        where: { authorGithubId: BigInt(OUTSIDER_GITHUB_ID) },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.collectionReleaseFact.count({
        where: { authorGithubId: BigInt(OUTSIDER_GITHUB_ID) },
      }),
    ).resolves.toBe(0);

    // facts에 없으니 집계 행도 팀원 하나뿐이다.
    const aggregates = await prisma.collectionContributorYearAggregate.findMany(
      {
        where: { repositoryId: collected.id },
        select: {
          githubUserId: true,
          githubLogin: true,
          pullRequestCount: true,
          releaseCount: true,
        },
      },
    );
    expect(aggregates).toHaveLength(1);
    expect(aggregates[0]?.githubUserId).toBe(MEMBER_GITHUB_ID);
    expect(aggregates[0]?.githubLogin).toBe('synthetic-member');
    expect(aggregates[0]?.pullRequestCount).toBe(1);
    expect(aggregates[0]?.releaseCount).toBe(1);

    // 커서는 거른 항목(가장 새 PR = 비팀원 것) 위에 선다 — 다음 run이 그 아래를 다시 받지 않는다.
    const stream = await prisma.collectionRepositoryStream.findUniqueOrThrow({
      where: {
        repositoryId_streamType: {
          repositoryId: collected.id,
          streamType: 'PULL_REQUEST',
        },
      },
      select: { status: true, frontierEntityId: true, frontierCreatedAt: true },
    });
    expect(stream.status).toBe('READY');
    expect(stream.frontierEntityId).toBe(9_000_000_680_202n);
    expect(stream.frontierCreatedAt).toEqual(
      new Date('2026-08-03T00:00:00.000Z'),
    );
  });

  it('`Repository` 행이 없어 팀을 특정할 수 없으면 종전대로 작성자를 가리지 않는다', async () => {
    // seed()를 부르지 않는다 — 수집 저장소만 있고 신청 산출물 `Repository`가 없는 상태.
    const client = createClient(
      [
        pullRequest({
          id: '9000000680204',
          authorLogin: 'synthetic-outsider',
          authorGithubId: OUTSIDER_GITHUB_ID,
        }),
      ],
      [
        release({
          id: '9000000680304',
          authorLogin: 'synthetic-outsider',
          authorGithubId: OUTSIDER_GITHUB_ID,
        }),
      ],
    );

    await createService(client).run(OWNER_ID);

    const collected = await prisma.githubRepository.findUniqueOrThrow({
      where: { githubRepositoryId: GITHUB_REPOSITORY_ID },
      select: { id: true },
    });
    await expect(
      prisma.collectionPullRequestFact.count({
        where: {
          repositoryId: collected.id,
          authorGithubId: BigInt(OUTSIDER_GITHUB_ID),
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.collectionReleaseFact.count({
        where: {
          repositoryId: collected.id,
          authorGithubId: BigInt(OUTSIDER_GITHUB_ID),
        },
      }),
    ).resolves.toBe(1);
  });

  it('팀원 합류를 감지하면 과거 PR을 한 번 백필하고 다음 sweep은 증분 frontier를 재사용한다', async () => {
    await seed();
    const latePullRequest = pullRequest({
      id: '9000000680205',
      createdAt: '2026-07-01T00:00:00.000Z',
      authorLogin: 'synthetic-late-member',
      authorGithubId: LATE_MEMBER_GITHUB_ID.toString(),
    });
    const listNewPullRequests = jest.fn(
      (
        _owner: string,
        _name: string,
        tie: { createdAt: string; id: string } | null,
      ) => {
        const pullRequests = tie === null ? [latePullRequest] : [];
        return Promise.resolve({
          pullRequests,
          newFrontier: pullRequests[0]
            ? {
                createdAt: pullRequests[0].createdAt,
                id: pullRequests[0].id,
              }
            : tie,
          fingerprint: fingerprint('/repos/o/r/pulls'),
        });
      },
    );
    const client = createClient([], []);
    (
      client as unknown as {
        listNewPullRequests: typeof listNewPullRequests;
      }
    ).listNewPullRequests = listNewPullRequests;
    const service = createService(client);

    await service.run(OWNER_ID);
    expect(listNewPullRequests.mock.calls[0]?.[2]).toBeNull();
    await expect(
      prisma.collectionPullRequestFact.count({
        where: { authorGithubId: LATE_MEMBER_GITHUB_ID },
      }),
    ).resolves.toBe(0);

    await prisma.user.create({
      data: {
        id: LATE_MEMBER_USER_ID,
        githubId: LATE_MEMBER_GITHUB_ID,
        nickname: 'synthetic-late-member',
      },
    });
    await prisma.teamMember.create({
      data: {
        teamId: TEAM_ID,
        programId: PROGRAM_ID,
        userId: LATE_MEMBER_USER_ID,
      },
    });

    await service.run(OWNER_ID);
    expect(listNewPullRequests.mock.calls[1]?.[2]).toBeNull();
    await expect(
      prisma.collectionPullRequestFact.count({
        where: { authorGithubId: LATE_MEMBER_GITHUB_ID },
      }),
    ).resolves.toBe(1);

    await service.run(OWNER_ID);
    expect(listNewPullRequests.mock.calls[2]?.[2]).toEqual({
      createdAt: '2026-07-01T00:00:00.000Z',
      id: '9000000680205',
    });
    await expect(
      prisma.collectionPullRequestFact.count({
        where: { authorGithubId: LATE_MEMBER_GITHUB_ID },
      }),
    ).resolves.toBe(1);

    const collected = await prisma.githubRepository.findUniqueOrThrow({
      where: { githubRepositoryId: GITHUB_REPOSITORY_ID },
      select: { id: true },
    });
    const stream = await prisma.collectionRepositoryStream.findUniqueOrThrow({
      where: {
        repositoryId_streamType: {
          repositoryId: collected.id,
          streamType: 'PULL_REQUEST',
        },
      },
      select: { frontierSha: true },
    });
    expect(stream.frontierSha).toMatch(/^team-members:v1:[0-9a-f]{64}$/);
  });
});
