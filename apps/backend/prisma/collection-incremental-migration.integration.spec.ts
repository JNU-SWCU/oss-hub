import { PrismaClient } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:414:';
const ORG_ID = 9_414_000_001n;
const REPO_ID = 9_414_000_101n;

const prisma = new PrismaClient();

async function cleanFixtures(): Promise<void> {
  await prisma.collectionCommitFact.deleteMany({
    where: { repository: { githubOrganizationId: ORG_ID } },
  });
  await prisma.collectionRepositoryYearAggregate.deleteMany({
    where: { repository: { githubOrganizationId: ORG_ID } },
  });
  await prisma.collectionContributorYearAggregate.deleteMany({
    where: { repository: { githubOrganizationId: ORG_ID } },
  });
  await prisma.collectionRepositoryStream.deleteMany({
    where: { repository: { githubOrganizationId: ORG_ID } },
  });
  await prisma.githubRepository.deleteMany({
    where: { githubOrganizationId: ORG_ID },
  });
  await prisma.application.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.program.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
}

async function tableExists(tableName: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ readonly exists: boolean }>>`
    SELECT to_regclass(${`public."${tableName}"`}) IS NOT NULL AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

async function indexExists(indexName: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ readonly exists: boolean }>>`
    SELECT to_regclass(${`public."${indexName}"`}) IS NOT NULL AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

describe('collection incremental migration — DB invariants', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(cleanFixtures);
  afterEach(cleanFixtures);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('기존 legacy/canonical 물리 테이블은 이 migration 이후에도 그대로 존재한다', async () => {
    await expect(tableExists('CollectionRun')).resolves.toBe(true);
    await expect(tableExists('GithubRawObservation')).resolves.toBe(true);
    await expect(tableExists('CanonicalCollectionRun')).resolves.toBe(true);
    await expect(tableExists('CanonicalRepository')).resolves.toBe(true);
    await expect(tableExists('CanonicalContributorProjection')).resolves.toBe(
      true,
    );
  });

  it('eligibility/frontier/author/year 인덱스가 모두 존재한다', async () => {
    await expect(
      indexExists('GithubRepository_visibility_presence_idx'),
    ).resolves.toBe(true);
    await expect(
      indexExists('CollectionRepositoryStream_status_idx'),
    ).resolves.toBe(true);
    await expect(
      indexExists('CollectionCommitFact_authorGithubId_idx'),
    ).resolves.toBe(true);
    await expect(
      indexExists('CollectionPullRequestFact_authorGithubId_idx'),
    ).resolves.toBe(true);
    await expect(
      indexExists('CollectionReleaseFact_authorGithubId_idx'),
    ).resolves.toBe(true);
    await expect(
      indexExists('CollectionRepositoryYearAggregate_year_idx'),
    ).resolves.toBe(true);
    await expect(
      indexExists('CollectionContributorYearAggregate_repositoryId_year_idx'),
    ).resolves.toBe(true);
  });

  it('App installation 교체를 흉내내도 논리 저장소는 org+repo id 기준 한 행만 유지한다', async () => {
    const observedAt = new Date('2026-07-31T00:00:00.000Z');
    const create = (): Promise<{ id: string }> =>
      prisma.githubRepository.upsert({
        where: { githubRepositoryId: REPO_ID },
        create: {
          githubOrganizationId: ORG_ID,
          githubRepositoryId: REPO_ID,
          nameWithOwner: 'org/repo',
          defaultBranch: 'main',
          source: 'ORG_PROVISIONED',
          visibility: 'PUBLIC',
          presence: 'PRESENT',
          lastCompleteInventoryObservedAt: observedAt,
        },
        update: { lastCompleteInventoryObservedAt: observedAt },
      });

    await create();
    await create(); // 두 번째 App installation이 다시 관측한 것을 흉내낸다.

    const rows = await prisma.githubRepository.findMany({
      where: { githubOrganizationId: ORG_ID, githubRepositoryId: REPO_ID },
    });
    expect(rows).toHaveLength(1);
  });

  it('commit fact의 (repositoryId, sha) 중복 삽입은 unique 제약 위반으로 거부된다', async () => {
    const repository = await prisma.githubRepository.create({
      data: {
        githubOrganizationId: ORG_ID,
        githubRepositoryId: REPO_ID + 1n,
        nameWithOwner: 'org/repo-2',
        defaultBranch: 'main',
        source: 'ORG_PROVISIONED',
        visibility: 'PRIVATE',
        presence: 'PRESENT',
      },
    });
    await prisma.collectionCommitFact.create({
      data: {
        repositoryId: repository.id,
        sha: 'duplicate-sha',
        committedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    });

    await expect(
      prisma.collectionCommitFact.create({
        data: {
          repositoryId: repository.id,
          sha: 'duplicate-sha',
          committedAt: new Date('2026-07-02T00:00:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('연도 집계 행이 없는 새해 1/1에는 빈 결과를 반환한다(0으로 안전하게 읽는다)', async () => {
    const repository = await prisma.githubRepository.create({
      data: {
        githubOrganizationId: ORG_ID,
        githubRepositoryId: REPO_ID + 2n,
        nameWithOwner: 'org/repo-3',
        defaultBranch: 'main',
        source: 'ORG_PROVISIONED',
        visibility: 'PUBLIC',
        presence: 'PRESENT',
      },
    });

    const rows = await prisma.collectionRepositoryYearAggregate.findMany({
      where: { repositoryId: repository.id, year: 2099 },
    });
    expect(rows).toEqual([]);
  });

  it('Application.isRepositoryPublicationPlanned는 미지정 시 true로 backfill/기본 설정되고 명시적 false를 왕복시킨다', async () => {
    await prisma.user.create({
      data: {
        id: `${TEST_PREFIX}user`,
        githubId: 9_414_000_201n,
        nickname: 'octocat-414',
      },
    });
    await prisma.user.create({
      data: {
        id: `${TEST_PREFIX}user:second`,
        githubId: 9_414_000_202n,
        nickname: 'octocat-414-second',
      },
    });
    await prisma.program.create({
      data: {
        id: `${TEST_PREFIX}program`,
        name: 'p',
        organizer: 'org',
        category: 'BASIC',
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-08-01T00:00:00Z'),
        applicationEndAt: new Date('2026-08-02T00:00:00Z'),
        description: 'd',
      },
    });

    const defaulted = await prisma.application.create({
      data: {
        id: `${TEST_PREFIX}application:default`,
        programId: `${TEST_PREFIX}program`,
        applicantId: `${TEST_PREFIX}user`,
        answers: {},
        applicationTemplateVersion: 1,
      },
    });
    expect(defaulted.isRepositoryPublicationPlanned).toBe(true);

    const explicitFalse = await prisma.application.create({
      data: {
        id: `${TEST_PREFIX}application:explicit-false`,
        programId: `${TEST_PREFIX}program`,
        applicantId: `${TEST_PREFIX}user:second`,
        answers: {},
        applicationTemplateVersion: 1,
        isRepositoryPublicationPlanned: false,
      },
    });
    expect(explicitFalse.isRepositoryPublicationPlanned).toBe(false);

    const reread = await prisma.application.findUniqueOrThrow({
      where: { id: explicitFalse.id },
    });
    expect(reread.isRepositoryPublicationPlanned).toBe(false);
  });
});
