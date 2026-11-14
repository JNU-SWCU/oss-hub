import { RepoLedgerRepository } from '../platform/repo-ledger.repository';
import { seedRepo, unlinkRepo } from '../../test/repo-ledger.fixture';
import { PlatformRepository } from '../platform/platform.repository';
import { ProgramCategory, RepositorySource } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { CollectionIncrementalRepository } from './collection-incremental.repository';
import { CollectionSyncService } from './collection-sync.service';
import type {
  CollectionAppClient,
  CollectionContribution,
  CollectionProbeResult,
  CollectionProbeTarget,
  CollectionRepositoryContributions,
} from './collection-app.client';
import type { CollectionAppTokenClient } from './collection-app-token.client';
import { CollectionAppClientError } from './collection-app.error';
import { ProviderRequestQueueClient } from './provider-request-queue.client';
import { RepositoryUrlService } from './repository-url.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const APP_ID = 9_000_000_680_001n;
const ORG_LOGIN = 'synthetic-probe-org';
const GITHUB_REPOSITORY_ID = 9_000_000_680_003n;
const OWNER_ID = 'synthetic-probe-suite';
const MEMBER_GITHUB_ID = 9_000_000_680_101n;
const OUTSIDER_GITHUB_ID = '9000000680102';

const SEED_PREFIX = 'synthetic-probe';
const PROGRAM_ID = `${SEED_PREFIX}-program`;
const TEAM_ID = `${SEED_PREFIX}-team`;
const MEMBER_USER_ID = `${SEED_PREFIX}-user`;
const NAME_WITH_OWNER = `${ORG_LOGIN}/probe-repo`;

const FIRST_RUN_AT = new Date('2026-11-14T10:00:00.000Z');
const SECOND_RUN_AT = new Date('2026-11-14T11:00:00.000Z');
const SKEW_MS = 5 * 60_000;

const contribution = (
  githubKey: string,
  authorGithubId: string | null,
): CollectionContribution => ({
  githubKey,
  authorGithubId,
  occurredAt: new Date('2026-11-14T08:00:00.000Z'),
});

const contributions = (
  pullRequests: readonly CollectionContribution[],
  commits: readonly CollectionContribution[] = [],
): CollectionRepositoryContributions => ({
  contributions: {
    commit: commits,
    pull_request: pullRequests,
    issue: [],
    release: [],
  },
  requests: 1,
  pointsUsed: 1,
  rateLimit: { cost: 1, remaining: 4999 },
});

const createClient = (activityAt: readonly Date[]) => ({
  probeRepositories: jest.fn(
    (
      targets: readonly CollectionProbeTarget[],
    ): Promise<CollectionProbeResult> =>
      Promise.resolve({
        repositories: targets.map((target) => ({
          githubRepositoryId: GITHUB_REPOSITORY_ID.toString(),
          nameWithOwner: `${target.owner}/${target.name}`,
          defaultBranch: 'main',
          archived: false,
          private: true,
          activityAt,
        })),
        rateLimit: { cost: 1, remaining: 4999 },
      }),
  ),
  getRepositoryById: jest.fn(),
  collectRepositoryContributions: jest.fn<
    Promise<CollectionRepositoryContributions>,
    [string, string, string | null, Date | null]
  >(),
});

class SuiteCollectionRepository extends CollectionIncrementalRepository {
  override async listCollectionTargets(source: RepositorySource) {
    return (await super.listCollectionTargets(source)).filter(
      (row) => row.githubRepositoryId === GITHUB_REPOSITORY_ID,
    );
  }
}

describe('CollectionSyncService — probe/collect (실 DB)', () => {
  const prisma = new PrismaService();
  let now = FIRST_RUN_AT;

  const createService = (
    client: ReturnType<typeof createClient>,
  ): CollectionSyncService =>
    new CollectionSyncService(
      new SuiteCollectionRepository(prisma, new PlatformRepository()),
      () => ({
        appId: APP_ID.toString(),
        organizationLogin: ORG_LOGIN,
        tokens: {} as CollectionAppTokenClient,
        client: client as unknown as CollectionAppClient,
        queue: new ProviderRequestQueueClient(),
      }),
      new RepositoryUrlService(),
      () => new Date(now),
      () => 'synthetic-probe-run',
    );

  const lastSuccessAt = async (): Promise<Date | null> =>
    (
      await prisma.repo.findUniqueOrThrow({
        where: { githubRepoId: GITHUB_REPOSITORY_ID },
        select: { lastSuccessAt: true },
      })
    ).lastSuccessAt;

  const seed = async (): Promise<void> => {
    await prisma.program.create({
      data: {
        startAt: new Date('2026-12-31T00:00:00.000Z'),
        endAt: new Date('2027-12-31T00:00:00.000Z'),
        id: PROGRAM_ID,
        name: 'synthetic probe program',
        organizer: 'synthetic',
        trackType: 'EXTRACURRICULAR',
        category: ProgramCategory.BASIC,
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
        name: 'synthetic probe team',
        leaderId: MEMBER_USER_ID,
        applicantId: MEMBER_USER_ID,
        answers: {},
        applicationTemplateVersion: 1,
        status: 'APPROVED',
      },
    });
    await prisma.teamMember.create({
      data: { teamId: TEAM_ID, programId: PROGRAM_ID, userId: MEMBER_USER_ID },
    });
    await seedRepo(prisma, {
      teamId: TEAM_ID,
      githubRepositoryId: GITHUB_REPOSITORY_ID,
      nameWithOwner: NAME_WITH_OWNER,
      defaultBranch: 'main',
      visibility: 'PRIVATE',
      source: RepositorySource.ORG_PROVISIONED,
    });
  };

  beforeAll(() => prisma.$connect(), 60_000);

  beforeEach(async () => {
    now = FIRST_RUN_AT;
    await seed();
  });

  afterEach(async () => {
    await new RepoLedgerRepository().remove(prisma, [GITHUB_REPOSITORY_ID]);
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CollectionSyncLease" WHERE "appId" = $1',
      APP_ID,
    );
    await prisma.teamMember.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.user.deleteMany({ where: { id: MEMBER_USER_ID } });
    await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
  });

  afterAll(() => prisma.$disconnect());

  it('첫 수집은 작성자와 상관없이 모두 원장에 넣고 last_success_at을 probe 시작 5분 전으로 둔다', async () => {
    const client = createClient([]);
    client.collectRepositoryContributions.mockResolvedValue(
      contributions([
        contribution('9000000680201', MEMBER_GITHUB_ID.toString()),
        contribution('9000000680202', OUTSIDER_GITHUB_ID),
        contribution('9000000680203', null),
      ]),
    );

    await expect(createService(client).run(OWNER_ID)).resolves.toMatchObject({
      status: 'COMPLETED',
      processedRepositoryCount: 1,
      insertedFactCount: 3,
    });

    expect(client.collectRepositoryContributions).toHaveBeenCalledWith(
      ORG_LOGIN,
      'probe-repo',
      'main',
      new Date(FIRST_RUN_AT.getTime() - 14 * 86_400_000),
    );
    await expect(
      prisma.contributionEvent.findMany({
        where: { repoId: GITHUB_REPOSITORY_ID },
        orderBy: { githubKey: 'asc' },
        select: { kind: true, githubKey: true, authorGithubId: true },
      }),
    ).resolves.toEqual([
      {
        kind: 'PULL_REQUEST',
        githubKey: '9000000680201',
        authorGithubId: MEMBER_GITHUB_ID,
      },
      {
        kind: 'PULL_REQUEST',
        githubKey: '9000000680202',
        authorGithubId: BigInt(OUTSIDER_GITHUB_ID),
      },
      {
        kind: 'PULL_REQUEST',
        githubKey: '9000000680203',
        authorGithubId: null,
      },
    ]);
    await expect(lastSuccessAt()).resolves.toEqual(
      new Date(FIRST_RUN_AT.getTime() - SKEW_MS),
    );
  });

  it('지난 성공 이후 활동이 없으면 수집 없이 last_success_at만 올린다', async () => {
    await prisma.repo.update({
      where: { githubRepoId: GITHUB_REPOSITORY_ID },
      data: { lastSuccessAt: new Date(FIRST_RUN_AT.getTime() - SKEW_MS) },
    });
    now = SECOND_RUN_AT;
    const client = createClient([new Date('2026-11-14T09:30:00.000Z')]);

    await expect(createService(client).run(OWNER_ID)).resolves.toMatchObject({
      status: 'COMPLETED',
      processedRepositoryCount: 0,
    });

    expect(client.probeRepositories).toHaveBeenCalledWith([
      { owner: ORG_LOGIN, name: 'probe-repo' },
    ]);
    expect(client.collectRepositoryContributions).not.toHaveBeenCalled();
    await expect(lastSuccessAt()).resolves.toEqual(
      new Date(SECOND_RUN_AT.getTime() - SKEW_MS),
    );
  });

  it('작성자를 몰랐던 기여는 다음 수집에서 작성자만 채우고 새 행으로 세지 않는다', async () => {
    const client = createClient([]);
    client.collectRepositoryContributions
      .mockResolvedValueOnce(contributions([], [contribution('sha-1', null)]))
      .mockResolvedValueOnce(
        contributions([], [contribution('sha-1', MEMBER_GITHUB_ID.toString())]),
      );
    const service = createService(client);

    await service.run(OWNER_ID);
    now = SECOND_RUN_AT;
    await expect(service.run(OWNER_ID, 'run-2', 'full')).resolves.toMatchObject(
      { insertedFactCount: 0 },
    );

    await expect(
      prisma.contributionEvent.findMany({
        where: { repoId: GITHUB_REPOSITORY_ID },
        select: { githubKey: true, authorGithubId: true },
      }),
    ).resolves.toEqual([
      { githubKey: 'sha-1', authorGithubId: MEMBER_GITHUB_ID },
    ]);
  });

  it.each(['PAGINATION', 'DEADLINE'] as const)(
    '%s로 잘린 수집은 기여도 last_success_at도 쓰지 않는다',
    async (kind) => {
      const before = new Date(FIRST_RUN_AT.getTime() - 3 * 3_600_000);
      await prisma.repo.update({
        where: { githubRepoId: GITHUB_REPOSITORY_ID },
        data: { lastSuccessAt: before },
      });
      const client = createClient([new Date('2026-11-14T09:00:00.000Z')]);
      client.collectRepositoryContributions.mockRejectedValue(
        new CollectionAppClientError(kind),
      );

      await expect(createService(client).run(OWNER_ID)).resolves.toMatchObject({
        status: 'COMPLETED',
      });

      await expect(lastSuccessAt()).resolves.toEqual(before);
      await expect(
        prisma.contributionEvent.count({
          where: { repoId: GITHUB_REPOSITORY_ID },
        }),
      ).resolves.toBe(0);
    },
  );

  it('팀 연결이 끊긴 저장소는 probe도 수집도 하지 않는다', async () => {
    await unlinkRepo(prisma, GITHUB_REPOSITORY_ID);
    const client = createClient([]);

    await createService(client).run(OWNER_ID);

    expect(client.probeRepositories).not.toHaveBeenCalled();
    expect(client.collectRepositoryContributions).not.toHaveBeenCalled();
    await expect(lastSuccessAt()).resolves.toBeNull();
  });
});
