import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { ConsentsRepository } from '../consents/consents.repository';
import { ConsentsService } from '../consents/consents.service';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionCutoverRepository } from './repository/collection-cutover.repository';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { RepositoryOwnEnrollmentService } from './service/repository-own-enrollment.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const enrollment = new CollectionIncrementalRepository(prisma);
const cutover = new CollectionCutoverRepository(prisma);
const REPOSITORY_IDS = [
  9_000_000_730_001n,
  9_000_000_730_002n,
  9_000_000_730_003n,
  9_000_000_730_004n,
] as const;
const OBSERVED_AT = new Date('2026-08-09T14:00:00.000Z');
const MEMBER_USER_ID = 'synthetic-external-enrollment-member';
const MEMBER_GITHUB_ID = 9_000_000_730_201n;
const OUTSIDER_GITHUB_ID = 9_000_000_730_202n;
const CONSENT_USER_ID = 'synthetic-own-enrollment-consent-user';
const CONSENT_GITHUB_ID = 9_000_000_730_203n;

describe('external repository enrollment integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma.githubRepository.deleteMany({
      where: { githubRepositoryId: { in: [...REPOSITORY_IDS] } },
    });
    await prisma.consent.deleteMany({
      where: { userId: { in: [MEMBER_USER_ID, CONSENT_USER_ID] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [MEMBER_USER_ID, CONSENT_USER_ID] } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('owner/name과 기본 브랜치를 갖춘 external 행을 즉시 수집 큐에 만든다', async () => {
    await enrollment.enrollExternalRepository({
      githubRepositoryId: REPOSITORY_IDS[0],
      nameWithOwner: 'synthetic-student/synthetic-own-repo',
      defaultBranch: 'main',
      archived: false,
      observedAt: OBSERVED_AT,
    });

    await expect(
      prisma.githubRepository.findUniqueOrThrow({
        where: { githubRepositoryId: REPOSITORY_IDS[0] },
      }),
    ).resolves.toMatchObject({
      nameWithOwner: 'synthetic-student/synthetic-own-repo',
      defaultBranch: 'main',
      archived: false,
      source: 'EXTERNAL_PUBLIC',
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      nextRunAt: OBSERVED_AT,
      failureCount: 0,
    });
  });

  it('기존 external PRIVATE·ABSENT 행을 복구하되 기존 fact·Contribution은 보존한다', async () => {
    await prisma.user.create({
      data: {
        id: MEMBER_USER_ID,
        githubId: MEMBER_GITHUB_ID,
        nickname: 'synthetic-external-enrollment-member',
      },
    });
    const repository = await prisma.githubRepository.create({
      data: {
        githubRepositoryId: REPOSITORY_IDS[1],
        nameWithOwner: 'stale/short-name',
        defaultBranch: null,
        archived: true,
        source: 'EXTERNAL_PUBLIC',
        visibility: 'PRIVATE',
        presence: 'ABSENT',
        nextRunAt: new Date('2026-08-10T00:00:00.000Z'),
        failureCount: 4,
      },
    });
    await prisma.collectionCommitFact.createMany({
      data: [
        {
          repositoryId: repository.id,
          sha: 'synthetic-member-commit',
          committedAt: OBSERVED_AT,
          authorGithubId: MEMBER_GITHUB_ID,
          authorGithubLogin: 'synthetic-external-enrollment-member',
        },
        {
          repositoryId: repository.id,
          sha: 'synthetic-outsider-commit',
          committedAt: OBSERVED_AT,
          authorGithubId: OUTSIDER_GITHUB_ID,
          authorGithubLogin: 'synthetic-outsider',
        },
        {
          repositoryId: repository.id,
          sha: 'synthetic-unresolved-commit',
          committedAt: OBSERVED_AT,
          authorGithubId: null,
          authorGithubLogin: 'synthetic-unresolved-outsider',
        },
      ],
    });
    await prisma.collectionPullRequestFact.createMany({
      data: [
        {
          repositoryId: repository.id,
          githubPullRequestId: 9_000_000_730_301n,
          state: 'MERGED',
          createdAt: OBSERVED_AT,
          authorGithubId: MEMBER_GITHUB_ID,
          authorGithubLogin: 'synthetic-external-enrollment-member',
        },
        {
          repositoryId: repository.id,
          githubPullRequestId: 9_000_000_730_302n,
          state: 'MERGED',
          createdAt: OBSERVED_AT,
          authorGithubId: OUTSIDER_GITHUB_ID,
          authorGithubLogin: 'synthetic-outsider',
        },
        {
          repositoryId: repository.id,
          githubPullRequestId: 9_000_000_730_303n,
          state: 'MERGED',
          createdAt: OBSERVED_AT,
          authorGithubId: null,
          authorGithubLogin: 'synthetic-unresolved-outsider',
        },
      ],
    });
    await prisma.collectionReleaseFact.createMany({
      data: [
        {
          repositoryId: repository.id,
          githubReleaseId: 9_000_000_730_401n,
          publishedAt: OBSERVED_AT,
          authorGithubId: MEMBER_GITHUB_ID,
          authorGithubLogin: 'synthetic-external-enrollment-member',
        },
        {
          repositoryId: repository.id,
          githubReleaseId: 9_000_000_730_402n,
          publishedAt: OBSERVED_AT,
          authorGithubId: OUTSIDER_GITHUB_ID,
          authorGithubLogin: 'synthetic-outsider',
        },
        {
          repositoryId: repository.id,
          githubReleaseId: 9_000_000_730_403n,
          publishedAt: OBSERVED_AT,
          authorGithubId: null,
          authorGithubLogin: 'synthetic-unresolved-outsider',
        },
      ],
    });
    await prisma.contribution.createMany({
      data: [
        {
          repositoryId: repository.id,
          githubId: MEMBER_GITHUB_ID,
          date: OBSERVED_AT,
          commitCount: 1,
          pullRequestCount: 1,
          releaseCount: 1,
        },
        {
          repositoryId: repository.id,
          githubId: OUTSIDER_GITHUB_ID,
          date: OBSERVED_AT,
          commitCount: 1,
          pullRequestCount: 1,
          releaseCount: 1,
        },
      ],
    });

    await enrollment.enrollExternalRepository({
      githubRepositoryId: REPOSITORY_IDS[1],
      nameWithOwner: 'synthetic-student/reconnected-repo',
      defaultBranch: 'trunk',
      archived: false,
      observedAt: OBSERVED_AT,
    });

    await expect(
      prisma.githubRepository.findUniqueOrThrow({
        where: { githubRepositoryId: REPOSITORY_IDS[1] },
      }),
    ).resolves.toMatchObject({
      nameWithOwner: 'synthetic-student/reconnected-repo',
      defaultBranch: 'trunk',
      archived: false,
      source: 'EXTERNAL_PUBLIC',
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      nextRunAt: OBSERVED_AT,
      failureCount: 0,
    });
    await expect(
      prisma.collectionCommitFact.findMany({
        where: { repositoryId: repository.id },
        orderBy: { sha: 'asc' },
        select: { authorGithubId: true, sha: true },
      }),
    ).resolves.toEqual([
      {
        authorGithubId: MEMBER_GITHUB_ID,
        sha: 'synthetic-member-commit',
      },
      {
        authorGithubId: OUTSIDER_GITHUB_ID,
        sha: 'synthetic-outsider-commit',
      },
      {
        authorGithubId: null,
        sha: 'synthetic-unresolved-commit',
      },
    ]);
    await expect(
      Promise.all([
        prisma.collectionPullRequestFact.findMany({
          where: { repositoryId: repository.id },
          orderBy: { githubPullRequestId: 'asc' },
          select: { authorGithubId: true },
        }),
        prisma.collectionReleaseFact.findMany({
          where: { repositoryId: repository.id },
          orderBy: { githubReleaseId: 'asc' },
          select: { authorGithubId: true },
        }),
        prisma.contribution.findMany({
          where: { repositoryId: repository.id },
          orderBy: { githubId: 'asc' },
          select: { githubId: true },
        }),
      ]),
    ).resolves.toEqual([
      [
        { authorGithubId: MEMBER_GITHUB_ID },
        { authorGithubId: OUTSIDER_GITHUB_ID },
        { authorGithubId: null },
      ],
      [
        { authorGithubId: MEMBER_GITHUB_ID },
        { authorGithubId: OUTSIDER_GITHUB_ID },
        { authorGithubId: null },
      ],
      [{ githubId: MEMBER_GITHUB_ID }, { githubId: OUTSIDER_GITHUB_ID }],
    ]);
  });

  it('같은 id의 기존 org 관찰은 external로 강등하거나 덮어쓰지 않는다', async () => {
    await prisma.githubRepository.create({
      data: {
        githubOrganizationId: 9_000_000_730_099n,
        githubRepositoryId: REPOSITORY_IDS[2],
        nameWithOwner: 'synthetic-org/org-repo',
        defaultBranch: 'main',
        archived: false,
        source: 'ORG_PROVISIONED',
        visibility: 'PRIVATE',
        presence: 'PRESENT',
      },
    });

    await enrollment.enrollExternalRepository({
      githubRepositoryId: REPOSITORY_IDS[2],
      nameWithOwner: 'synthetic-student/claimed-repo',
      defaultBranch: 'trunk',
      archived: true,
      observedAt: OBSERVED_AT,
    });

    await expect(
      prisma.githubRepository.findUniqueOrThrow({
        where: { githubRepositoryId: REPOSITORY_IDS[2] },
      }),
    ).resolves.toMatchObject({
      githubOrganizationId: 9_000_000_730_099n,
      nameWithOwner: 'synthetic-org/org-repo',
      defaultBranch: 'main',
      archived: false,
      source: 'ORG_PROVISIONED',
      visibility: 'PRIVATE',
      presence: 'PRESENT',
    });
  });

  it('external snapshot 뒤 org로 승격된 저장소의 기존 fact를 정리하지 않는다', async () => {
    const repository = await prisma.githubRepository.create({
      data: {
        githubRepositoryId: REPOSITORY_IDS[2],
        nameWithOwner: 'synthetic-student/promoted-repo',
        defaultBranch: 'main',
        archived: false,
        source: 'EXTERNAL_PUBLIC',
        visibility: 'PUBLIC',
        presence: 'PRESENT',
      },
    });
    await prisma.collectionCommitFact.create({
      data: {
        repositoryId: repository.id,
        sha: 'synthetic-promoted-commit',
        committedAt: OBSERVED_AT,
        authorGithubId: OUTSIDER_GITHUB_ID,
        authorGithubLogin: 'synthetic-outsider',
      },
    });
    await prisma.collectionPullRequestFact.create({
      data: {
        repositoryId: repository.id,
        githubPullRequestId: 9_000_000_730_501n,
        state: 'MERGED',
        createdAt: OBSERVED_AT,
        authorGithubId: OUTSIDER_GITHUB_ID,
        authorGithubLogin: 'synthetic-outsider',
      },
    });
    await prisma.collectionReleaseFact.create({
      data: {
        repositoryId: repository.id,
        githubReleaseId: 9_000_000_730_502n,
        publishedAt: OBSERVED_AT,
        authorGithubId: OUTSIDER_GITHUB_ID,
        authorGithubLogin: 'synthetic-outsider',
      },
    });
    await prisma.contribution.create({
      data: {
        repositoryId: repository.id,
        githubId: OUTSIDER_GITHUB_ID,
        date: OBSERVED_AT,
        commitCount: 1,
        pullRequestCount: 1,
        releaseCount: 1,
      },
    });

    await prisma.githubRepository.update({
      where: { id: repository.id },
      data: {
        githubOrganizationId: 9_000_000_730_099n,
        source: 'ORG_PROVISIONED',
      },
    });
    await expect(
      enrollment.enrollExternalRepository({
        githubRepositoryId: REPOSITORY_IDS[2],
        nameWithOwner: 'synthetic-student/promoted-repo',
        defaultBranch: 'main',
        archived: false,
        observedAt: OBSERVED_AT,
      }),
    ).resolves.toBe(false);
    await expect(
      Promise.all([
        prisma.collectionCommitFact.count({
          where: { repositoryId: repository.id },
        }),
        prisma.collectionPullRequestFact.count({
          where: { repositoryId: repository.id },
        }),
        prisma.collectionReleaseFact.count({
          where: { repositoryId: repository.id },
        }),
        prisma.contribution.count({
          where: { repositoryId: repository.id },
        }),
      ]),
    ).resolves.toEqual([1, 1, 1, 1]);
    await expect(
      Promise.all([
        cutover.countCommitFactsForRepositories(
          [repository.id],
          new Set([MEMBER_GITHUB_ID]),
        ),
        cutover.countPullRequestFactsForRepositories(
          [repository.id],
          new Set([MEMBER_GITHUB_ID]),
        ),
        cutover.countReleaseFactsForRepositories(
          [repository.id],
          new Set([MEMBER_GITHUB_ID]),
        ),
      ]),
    ).resolves.toEqual([0, 0, 0]);
  });

  it('동일 id 동시 편입이 unique 오류 없이 한 행으로 수렴한다', async () => {
    const input = {
      githubRepositoryId: REPOSITORY_IDS[3],
      nameWithOwner: 'synthetic-student/concurrent-repo',
      defaultBranch: 'main',
      archived: false,
      observedAt: OBSERVED_AT,
    } as const;

    await expect(
      Promise.all([
        enrollment.enrollExternalRepository(input),
        enrollment.enrollExternalRepository(input),
      ]),
    ).resolves.toEqual([true, true]);
    await expect(
      prisma.githubRepository.count({
        where: { githubRepositoryId: REPOSITORY_IDS[3] },
      }),
    ).resolves.toBe(1);
  });

  it('현재 동의가 없는 OWN 신청자는 수집 행을 만들 수 없다', async () => {
    await prisma.user.create({
      data: {
        id: CONSENT_USER_ID,
        githubId: CONSENT_GITHUB_ID,
        nickname: 'synthetic-own-enrollment-consent-user',
      },
    });
    const consents = new ConsentsService(new ConsentsRepository(prisma));
    const service = new RepositoryOwnEnrollmentService(consents, enrollment);
    const input = {
      applicantGithubId: CONSENT_GITHUB_ID,
      githubRepositoryId: REPOSITORY_IDS[0],
      nameWithOwner: 'synthetic-student/consent-repo',
      defaultBranch: 'main',
      archived: false,
      observedAt: OBSERVED_AT,
    } as const;

    await expect(service.enrollExternalRepository(input)).rejects.toMatchObject(
      { name: 'DomainException' },
    );
    await expect(
      prisma.githubRepository.count({
        where: { githubRepositoryId: REPOSITORY_IDS[0] },
      }),
    ).resolves.toBe(0);

    const current = await consents.getCurrent(CONSENT_GITHUB_ID);
    await prisma.consent.create({
      data: {
        userId: CONSENT_USER_ID,
        policyVersion: current.policy.policyVersion,
      },
    });
    await expect(
      service.enrollExternalRepository(input),
    ).resolves.toBeUndefined();
    await expect(
      prisma.githubRepository.count({
        where: { githubRepositoryId: REPOSITORY_IDS[0] },
      }),
    ).resolves.toBe(1);
  });
});
