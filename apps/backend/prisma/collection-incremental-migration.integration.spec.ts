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
  await prisma.contribution.deleteMany({
    where: { repository: { githubOrganizationId: ORG_ID } },
  });
  await prisma.contribution.deleteMany({
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
  await prisma.teamMember.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.team.deleteMany({
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
    // 옛 연도 집계는 드롭됐다(20260809140000). 지금 사실 테이블은 `Contribution`
    // 하나이며 두 축을 각각 인덱스가 받친다(ADR-010 §4).
    await expect(indexExists('Contribution_githubId_date_idx')).resolves.toBe(
      true,
    );
    await expect(indexExists('Contribution_date_idx')).resolves.toBe(true);
    // 이 브랜치가 물리 삭제를 담당한다 — 드롭이 실제로 적용됐는지 본다.
    // 테이블이 남아 있으면 옛 writer 가 되살아날 여지가 생긴다.
    await expect(
      indexExists('CollectionRepositoryYearAggregate_year_idx'),
    ).resolves.toBe(false);
    await expect(
      indexExists('CollectionContributorYearAggregate_repositoryId_year_idx'),
    ).resolves.toBe(false);
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

    const rows = await prisma.contribution.findMany({
      // 저장에 연도 칸이 없으므로 날짜 범위로 묻는다(ADR-010 §4).
      where: {
        repositoryId: repository.id,
        date: {
          gte: new Date(Date.UTC(2099, 0, 1)),
          lt: new Date(Date.UTC(2100, 0, 1)),
        },
      },
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

    await prisma.team.createMany({
      data: [
        {
          id: `${TEST_PREFIX}team:default`,
          programId: `${TEST_PREFIX}program`,
          name: `${TEST_PREFIX}team-default`,
          joinCodeDigest: `${TEST_PREFIX}digest-default`,
          leaderId: `${TEST_PREFIX}user`,
        },
        {
          id: `${TEST_PREFIX}team:explicit-false`,
          programId: `${TEST_PREFIX}program`,
          name: `${TEST_PREFIX}team-explicit-false`,
          joinCodeDigest: `${TEST_PREFIX}digest-explicit-false`,
          leaderId: `${TEST_PREFIX}user:second`,
        },
      ],
    });
    await prisma.teamMember.createMany({
      data: [
        {
          id: `${TEST_PREFIX}member:default`,
          teamId: `${TEST_PREFIX}team:default`,
          programId: `${TEST_PREFIX}program`,
          userId: `${TEST_PREFIX}user`,
        },
        {
          id: `${TEST_PREFIX}member:explicit-false`,
          teamId: `${TEST_PREFIX}team:explicit-false`,
          programId: `${TEST_PREFIX}program`,
          userId: `${TEST_PREFIX}user:second`,
        },
      ],
    });

    const defaulted = await prisma.application.create({
      data: {
        id: `${TEST_PREFIX}application:default`,
        programId: `${TEST_PREFIX}program`,
        applicantId: `${TEST_PREFIX}user`,
        teamId: `${TEST_PREFIX}team:default`,
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
        teamId: `${TEST_PREFIX}team:explicit-false`,
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
