import { PlatformRepository } from '../platform/platform.repository';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { UserPolicyRepository } from '../users/user-policy.repository';
import { ConsentsService } from '../users/consents.service';
import { PrismaService } from '../platform/prisma.service';
import { CollectionIncrementalRepository } from './collection-incremental.repository';
import { RepositoryOwnEnrollmentService } from './repositories.service';
import {
  repositoryContributionTotals,
  seedDailyContributions,
} from '../../test/ledger-contribution.fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const enrollment = new CollectionIncrementalRepository(
  prisma,
  new PlatformRepository(),
);
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
    await prisma.contributionEvent.deleteMany({
      where: { repoId: { in: [...REPOSITORY_IDS] } },
    });
    await prisma.repo.deleteMany({
      where: { githubRepoId: { in: [...REPOSITORY_IDS] } },
    });
    await prisma.githubRepository.deleteMany({
      where: { githubRepositoryId: { in: [...REPOSITORY_IDS] } },
    });
    await prisma.userPolicy.deleteMany({
      where: { userId: { in: [MEMBER_USER_ID, CONSENT_USER_ID] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [MEMBER_USER_ID, CONSENT_USER_ID] } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('연결 후처리가 늦게 도착해도 삭제된 external 행을 다시 만들지 않는다', async () => {
    await enrollment.enrollExternalRepository({
      githubRepositoryId: REPOSITORY_IDS[0],
      nameWithOwner: 'synthetic-student/synthetic-own-repo',
      defaultBranch: 'main',
      archived: false,
      observedAt: OBSERVED_AT,
    });

    await expect(
      prisma.githubRepository.findUnique({
        where: { githubRepositoryId: REPOSITORY_IDS[0] },
      }),
    ).resolves.toBeNull();
  });

  it('기존 external PRIVATE·ABSENT 행을 복구하되 기존 원장 이벤트는 보존한다', async () => {
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
    await seedDailyContributions(
      prisma,
      REPOSITORY_IDS[1],
      [
        {
          githubId: MEMBER_GITHUB_ID,
          date: '2026-08-09',
          commitCount: 1,
          pullRequestCount: 1,
          releaseCount: 1,
        },
        {
          githubId: OUTSIDER_GITHUB_ID,
          date: '2026-08-09',
          commitCount: 1,
          pullRequestCount: 1,
          releaseCount: 1,
        },
      ],
      'EXTERNAL_PUBLIC',
    );

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
      repositoryContributionTotals(prisma, [repository.id]),
    ).resolves.toEqual({
      commitCount: 2,
      pullRequestCount: 2,
      releaseCount: 2,
      issueCount: 0,
    });
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

  it('external snapshot 뒤 org로 승격된 저장소의 기존 원장 이벤트를 정리하지 않는다', async () => {
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
    await seedDailyContributions(
      prisma,
      REPOSITORY_IDS[2],
      [
        {
          githubId: OUTSIDER_GITHUB_ID,
          date: '2026-08-09',
          commitCount: 1,
          pullRequestCount: 1,
          releaseCount: 1,
        },
      ],
      'EXTERNAL_PUBLIC',
    );

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
      repositoryContributionTotals(prisma, [repository.id]),
    ).resolves.toEqual({
      commitCount: 1,
      pullRequestCount: 1,
      releaseCount: 1,
      issueCount: 0,
    });
    await expect(
      prisma.contributionEvent.count({
        where: {
          repoId: REPOSITORY_IDS[2],
          authorGithubId: MEMBER_GITHUB_ID,
        },
      }),
    ).resolves.toBe(0);
  });

  it('이미 연결된 동일 id의 동시 후처리는 한 행을 유지한다', async () => {
    const input = {
      githubRepositoryId: REPOSITORY_IDS[3],
      nameWithOwner: 'synthetic-student/concurrent-repo',
      defaultBranch: 'main',
      archived: false,
      observedAt: OBSERVED_AT,
    } as const;
    await prisma.githubRepository.create({
      data: {
        githubRepositoryId: input.githubRepositoryId,
        nameWithOwner: input.nameWithOwner,
        source: 'EXTERNAL_PUBLIC',
      },
    });

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
    const consents = new ConsentsService(new UserPolicyRepository(prisma));
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
    await prisma.userPolicy.create({
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
    ).resolves.toBe(0);
  });
});
