import { PlatformRepository } from '../platform/platform.repository';
import { PublicEligibilityRepository } from './public-eligibility.repository';
import {
  ApplicationStatus,
  CollectionRepositoryPresence,
  ProgramCategory,
  RepositorySource,
  RepositoryVisibility,
  ProgramTrackType,
} from '@prisma/client';
import { DepartmentType, MemberKind } from '../users/user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { PublicProjectMetricsRepository } from './public-project-metrics.repository';
import { loadRuntimeConfig } from '../platform/runtime-config.config';
import {
  PublicEligibilityService,
  PublicProjectsService,
} from './public-projects.service';
import { PublicUserProfileResponseDto } from './dto/public-user-profile-response.dto';
import { PublicProjectsRepository } from './public-projects.repository';
import { RepositoryUrlService } from '../github/repository-url.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const SYNTHETIC_SESSION_SECRET = Buffer.from(
  'synthetic-public-projects-integration-secret',
).toString('base64url');

const prisma = new PrismaService();
const metrics = new PublicProjectMetricsRepository(
  prisma,
  new PlatformRepository(),
);
const eligibilityMetrics = new PublicEligibilityRepository(
  prisma,
  new PlatformRepository(),
);
const eligibilityService = new PublicEligibilityService(eligibilityMetrics);
const publicProjectsRepository = new PublicProjectsRepository(prisma);
const service = new PublicProjectsService(
  publicProjectsRepository,
  eligibilityService,
  metrics,
  loadRuntimeConfig({ SESSION_SECRET: SYNTHETIC_SESSION_SECRET }),
  new RepositoryUrlService(),
);

const PREFIX = 'synthetic-public-profile';
const PROGRAM_ID = `${PREFIX}-program`;
const OWNER_ID = `${PREFIX}-owner`;
const OWNER_GITHUB_ID = 8_800_000_000_001n;
const OTHER_CONTRIBUTOR_GITHUB_ID = 8_800_000_000_002n;
const repoKeys = ['a', 'b', 'c', 'd', 'e'] as const;
const PUBLISHED_AT = new Date('2026-06-01T00:00:00.000Z');

describe('PublicProjectsService.findProfile integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.program.createMany({
      data: repoKeys.map((key) => ({
        id: `${PROGRAM_ID}-${key}`,
        name: `${PREFIX}-program`,
        organizer: 'synthetic-organizer',
        trackType: ProgramTrackType.EXTRACURRICULAR,
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'synthetic-template',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01'),
        applicationEndAt: new Date('2026-02-01'),
        startAt: new Date('2026-01-01'),
        endAt: new Date('2027-02-01'),
        description: 'synthetic-description',
        teamMaxSize: 4,
      })),
    });

    await prisma.user.create({
      data: {
        id: OWNER_ID,
        githubId: OWNER_GITHUB_ID,
        nickname: `${PREFIX}-owner-login`,
        avatarUrl: `https://avatars.githubusercontent.com/u/${PREFIX}-owner-avatar`,
        name: 'synthetic-real-name',
        studentId: '880001',
        department: 'synthetic-department',
        type: MemberKind.STUDENT,
        departmentType: DepartmentType.DEPARTMENT,
        profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        approvalStatus: 'NOT_REQUIRED',
      },
    });

    await prisma.user.create({
      data: {
        id: `${PREFIX}-applicant-c`,
        githubId: 8800000001002n,
        nickname: `${PREFIX}-applicant-c`,
        type: MemberKind.STUDENT,
        approvalStatus: 'NOT_REQUIRED',
      },
    });
    await prisma.team.createMany({
      data: repoKeys.map((key) => ({
        id: `${PREFIX}-team-${key}`,
        programId: `${PROGRAM_ID}-${key}`,
        name: `${PREFIX}-team-${key}`,
        leaderId: key === 'c' ? `${PREFIX}-applicant-c` : OWNER_ID,
        applicantId: key === 'c' ? `${PREFIX}-applicant-c` : OWNER_ID,
        answers: {},
        applicationTemplateVersion: 1,
        status: ApplicationStatus.APPROVED,
      })),
    });
    await prisma.teamMember.createMany({
      data: repoKeys.map((key) => ({
        teamId: `${PREFIX}-team-${key}`,
        programId: `${PROGRAM_ID}-${key}`,
        userId: key === 'c' ? `${PREFIX}-applicant-c` : OWNER_ID,
      })),
    });
    const githubRepositoryIdByKey: Record<(typeof repoKeys)[number], bigint> = {
      a: 8_900_000_000_001n,
      b: 8_900_000_000_002n,
      c: 8_900_000_000_003n,
      d: 8_900_000_000_004n,
      e: 8_900_000_000_005n,
    };

    const observedKeys = ['a', 'b', 'd'] as const;
    const preSweepKeys = ['e'] as const;
    await prisma.githubRepository.createMany({
      data: repoKeys.map((key) => ({
        id: `${PREFIX}-repository-${key}`,
        teamId: `${PREFIX}-team-${key}`,
        githubRepositoryId: githubRepositoryIdByKey[key],
        nameWithOwner: `synthetic-org/${PREFIX}-repo-${key}`,
        source: RepositorySource.ORG_PROVISIONED,
        visibility: RepositoryVisibility.PUBLIC,
        publishedAt: PUBLISHED_AT,
        ...((observedKeys as readonly string[]).includes(key)
          ? {
              githubOrganizationId: 8800500000000n,
              defaultBranch: 'main',
              presence: CollectionRepositoryPresence.PRESENT,
              lastCompleteInventoryObservedAt: new Date(
                '2026-05-01T00:00:00.000Z',
              ),
            }
          : (preSweepKeys as readonly string[]).includes(key)
            ? {
                githubOrganizationId: 8800500000000n,
                defaultBranch: 'main',
                presence: CollectionRepositoryPresence.PRESENT,
              }
            : { presence: CollectionRepositoryPresence.ABSENT }),
      })),
    });

    await prisma.contribution.createMany({
      data: [
        {
          repositoryId: `${PREFIX}-repository-a`,
          githubId: OWNER_GITHUB_ID,
          date: new Date(Date.UTC(2026, 0, 2)),
          commitCount: 3,
          pullRequestCount: 1,
          releaseCount: 0,
        },
        {
          repositoryId: `${PREFIX}-repository-a`,
          githubId: OTHER_CONTRIBUTOR_GITHUB_ID,
          date: new Date(Date.UTC(2026, 0, 2)),
          commitCount: 999,
          pullRequestCount: 999,
          releaseCount: 999,
        },
      ],
    });

    await prisma.contribution.create({
      data: {
        repositoryId: `${PREFIX}-repository-b`,
        githubId: OWNER_GITHUB_ID,
        date: new Date(Date.UTC(2026, 0, 2)),
        commitCount: 4,
        pullRequestCount: 0,
        releaseCount: 2,
      },
    });

    await prisma.contribution.create({
      data: {
        repositoryId: `${PREFIX}-repository-d`,
        githubId: OTHER_CONTRIBUTOR_GITHUB_ID,
        date: new Date(Date.UTC(2026, 0, 2)),
        commitCount: 10,
        pullRequestCount: 2,
        releaseCount: 1,
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.contribution.deleteMany({
        where: {
          repositoryId: { startsWith: `${PREFIX}-repository` },
        },
      });

      await prisma.githubRepository.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.teamMember.deleteMany({
        where: { programId: { startsWith: PROGRAM_ID } },
      });
      await prisma.team.deleteMany({
        where: { programId: { startsWith: PROGRAM_ID } },
      });

      await prisma.user.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.program.deleteMany({
        where: { id: { startsWith: PROGRAM_ID } },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it(
    '두 저장소(a/b) 합산이 정확하고, 다른 기여자의 활동은 배제되며, ' +
      '관측-0(d)과 미관측(c)과 pre-sweep(e, #893)이 서로 다르게 표현된다',
    async () => {
      const result = await service.findProfile(OWNER_ID);

      expect(result.identity.githubNickname).toBe(`${PREFIX}-owner-login`);
      expect(result.projects).toHaveLength(4);

      const byKey = new Map(
        result.projects.map((project) => [project.row.id, project]),
      );
      const repoA = byKey.get(`${PREFIX}-repository-a`);
      const repoB = byKey.get(`${PREFIX}-repository-b`);
      const repoC = byKey.get(`${PREFIX}-repository-c`);
      const repoD = byKey.get(`${PREFIX}-repository-d`);
      const repoE = byKey.get(`${PREFIX}-repository-e`);

      expect(repoA?.observed).toBe(true);
      expect(repoA?.hasCollectedData).toBe(true);
      expect(repoA?.metrics).toEqual({
        commitCount: 3,
        pullRequestCount: 1,
        releaseCount: 0,
      });

      expect(repoB?.observed).toBe(true);
      expect(repoB?.hasCollectedData).toBe(true);
      expect(repoB?.metrics).toEqual({
        commitCount: 4,
        pullRequestCount: 0,
        releaseCount: 2,
      });

      expect(repoC).toBeUndefined();

      expect(repoD?.observed).toBe(true);
      expect(repoD?.hasCollectedData).toBe(true);
      expect(repoD?.metrics).toEqual({
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
      });
      expect(repoD?.dataAsOf).not.toBeNull();

      expect(repoE?.observed).toBe(true);
      expect(repoE?.hasCollectedData).toBe(false);
      expect(repoE?.metrics).toEqual({
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
      });
      expect(repoE?.dataAsOf).not.toBeNull();

      expect(result.observedTotals).toEqual({
        commitCount: 7,
        pullRequestCount: 1,
        releaseCount: 2,
      });
    },
  );

  it('unobserved 저장소를 사용자 목록에 포함시키면 observed:false, dataAsOf:null, metrics:null로 표현된다', async () => {
    await prisma.teamMember.create({
      data: {
        teamId: `${PREFIX}-team-c`,
        programId: `${PROGRAM_ID}-c`,
        userId: OWNER_ID,
      },
    });
    try {
      const result = await service.findProfile(OWNER_ID);
      const repoC = result.projects.find(
        (project) => project.row.id === `${PREFIX}-repository-c`,
      );

      expect(repoC?.observed).toBe(false);
      expect(repoC?.hasCollectedData).toBe(false);
      expect(repoC?.dataAsOf).toBeNull();
      expect(repoC?.metrics).toBeNull();
    } finally {
      await prisma.teamMember.delete({
        where: {
          teamId_userId: { teamId: `${PREFIX}-team-c`, userId: OWNER_ID },
        },
      });
    }
  });

  it('공개 기여가 없는 사용자는 존재하지 않는 사용자와 동일하게 404(프로필 없음) 처리된다', async () => {
    const bystanderId = `${PREFIX}-bystander`;
    await prisma.user.create({
      data: {
        id: bystanderId,
        githubId: 8800999000001n,
        nickname: `${PREFIX}-bystander-login`,
        type: MemberKind.STUDENT,
        approvalStatus: 'NOT_REQUIRED',
      },
    });
    try {
      await expect(service.findProfile(bystanderId)).rejects.toThrow();
      await expect(service.findProfile('does-not-exist')).rejects.toThrow();
    } finally {
      await prisma.user.delete({ where: { id: bystanderId } });
    }
  });

  it('직렬화된 응답 DTO에는 실명/학번/학과/이메일/역할/githubId가 절대 나타나지 않는다', async () => {
    const result = await service.findProfile(OWNER_ID);
    const serialized = JSON.stringify(
      PublicUserProfileResponseDto.from(result),
    );

    expect(serialized).not.toContain('synthetic-real-name');
    expect(serialized).not.toContain(`${PREFIX}-student-id`);
    expect(serialized).not.toContain('synthetic-department');
    expect(serialized).not.toContain(OWNER_GITHUB_ID.toString());
    for (const forbidden of [
      '"name"',
      '"studentId"',
      '"department"',
      '"email"',
      '"role"',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
