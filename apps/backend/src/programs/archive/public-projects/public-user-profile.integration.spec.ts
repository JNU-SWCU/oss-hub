import {
  AffiliationKind,
  ApplicationStatus,
  CollectionRepositoryPresence,
  MemberKind,
  ProgramCategory,
  RepositorySource,
  RepositoryVisibility,
  ProgramTrackType,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../../test/integration-database.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProgramMetricsRepository } from '../../repository/program-metrics.repository';
import { loadRuntimeConfig } from '../../../runtime-config/runtime-config';
import { PublicEligibilityService } from '../public-eligibility/public-eligibility.service';
import { PublicUserProfileResponseDto } from './dto/public-user-profile-response.dto';
import { PublicProjectsRepository } from './public-projects.repository';
import { PublicProjectsService } from './public-projects.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const SYNTHETIC_SESSION_SECRET = Buffer.from(
  'synthetic-public-projects-integration-secret',
).toString('base64url');

const prisma = new PrismaService();
const metrics = new ProgramMetricsRepository(prisma);
const eligibilityService = new PublicEligibilityService(metrics);
const publicProjectsRepository = new PublicProjectsRepository(prisma);
const service = new PublicProjectsService(
  publicProjectsRepository,
  eligibilityService,
  metrics,
  loadRuntimeConfig({ SESSION_SECRET: SYNTHETIC_SESSION_SECRET }),
);

const PREFIX = 'synthetic-public-profile';
const PROGRAM_ID = `${PREFIX}-program`;
const OWNER_ID = `${PREFIX}-owner`;
const OWNER_GITHUB_ID = 8_800_000_000_001n;
const OTHER_CONTRIBUTOR_GITHUB_ID = 8_800_000_000_002n;
const PUBLISHED_AT = new Date('2026-06-01T00:00:00.000Z');

describe('PublicProjectsService.findProfile integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.program.create({
      data: {
        id: PROGRAM_ID,
        name: `${PREFIX}-program`,
        organizer: 'synthetic-organizer',
        trackType: ProgramTrackType.EXTRACURRICULAR,
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'synthetic-template',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
        description: 'synthetic-description',
      },
    });

    await prisma.user.create({
      data: {
        id: OWNER_ID,
        githubId: OWNER_GITHUB_ID,
        nickname: `${PREFIX}-owner-login`,
        avatarUrl: `https://avatars.githubusercontent.com/u/${PREFIX}-owner-avatar`,
        selectedMemberKind: MemberKind.STUDENT,
        profile: {
          create: {
            name: 'synthetic-real-name',
            studentId: '880001',
            department: 'synthetic-department',
            memberKind: MemberKind.STUDENT,
            affiliationKind: AffiliationKind.DEPARTMENT,
            affiliationName: 'synthetic-department',
          },
        },
      },
    });

    const repoKeys = ['a', 'b', 'c', 'd', 'e'] as const;
    const applicantIds = repoKeys.map((key) => `${PREFIX}-applicant-${key}`);
    await prisma.user.createMany({
      data: repoKeys.map((key, index) => ({
        id: `${PREFIX}-applicant-${key}`,
        githubId: 8_800_000_001_000n + BigInt(index),
        nickname: `${PREFIX}-applicant-${key}`,
        selectedMemberKind: MemberKind.STUDENT,
      })),
    });
    const applicationIds = repoKeys.map(
      (key) => `${PREFIX}-application-${key}`,
    );
    await prisma.team.createMany({
      data: repoKeys.map((key, index) => ({
        id: `${PREFIX}-application-team-${key}`,
        programId: PROGRAM_ID,
        name: `${PREFIX}-application-team-${key}`,
        joinCodeDigest: `${PREFIX}-application-team-digest-${key}`,
        leaderId: applicantIds[index]!,
      })),
    });
    await prisma.teamMember.createMany({
      data: repoKeys.map((key, index) => ({
        id: `${PREFIX}-application-team-member-${key}`,
        teamId: `${PREFIX}-application-team-${key}`,
        programId: PROGRAM_ID,
        userId: applicantIds[index]!,
      })),
    });
    await prisma.application.createMany({
      data: repoKeys.map((key, index) => ({
        id: `${PREFIX}-application-${key}`,
        programId: PROGRAM_ID,
        applicantId: applicantIds[index]!,
        teamId: `${PREFIX}-application-team-${key}`,
        answers: {},
        applicationTemplateVersion: 1,
        status: ApplicationStatus.APPROVED,
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
      data: repoKeys.map((key, index) => ({
        id: `${PREFIX}-repository-${key}`,
        applicationId: applicationIds[index]!,
        programId: PROGRAM_ID,
        githubRepositoryId: githubRepositoryIdByKey[key],
        nameWithOwner: `synthetic-org/${PREFIX}-repo-${key}`,
        source: RepositorySource.ORG_PROVISIONED,
        visibility: RepositoryVisibility.PUBLIC,
        publishedAt: PUBLISHED_AT,
        ...((observedKeys as readonly string[]).includes(key)
          ? {
              githubOrganizationId: 8_800_500_000_000n,
              defaultBranch: 'main',
              presence: CollectionRepositoryPresence.PRESENT,
              lastCompleteInventoryObservedAt: new Date(
                '2026-05-01T00:00:00.000Z',
              ),
            }
          : (preSweepKeys as readonly string[]).includes(key)
            ? {
                githubOrganizationId: 8_800_500_000_000n,
                defaultBranch: 'main',
                presence: CollectionRepositoryPresence.PRESENT,
              }
            : { presence: CollectionRepositoryPresence.ABSENT }),
      })),
    });

    for (const key of [...observedKeys, ...preSweepKeys]) {
      await prisma.team.create({
        data: {
          id: `${PREFIX}-team-${key}`,
          programId: PROGRAM_ID,
          name: `${PREFIX}-team-${key}`,
          joinCodeDigest: `${PREFIX}-join-code-digest-${key}`,
          leaderId: OWNER_ID,
          repositories: { connect: { id: `${PREFIX}-repository-${key}` } },
        },
      });
    }

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
        where: { programId: PROGRAM_ID },
      });
      await prisma.application.deleteMany({ where: { programId: PROGRAM_ID } });
      await prisma.teamMember.deleteMany({ where: { programId: PROGRAM_ID } });
      await prisma.team.deleteMany({
        where: { programId: PROGRAM_ID },
      });
      await prisma.userProfile.deleteMany({ where: { userId: OWNER_ID } });
      await prisma.user.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
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
    await prisma.team.create({
      data: {
        id: `${PREFIX}-team-c`,
        programId: PROGRAM_ID,
        name: `${PREFIX}-team-c`,
        joinCodeDigest: `${PREFIX}-join-code-digest-c`,
        leaderId: OWNER_ID,
        repositories: { connect: { id: `${PREFIX}-repository-c` } },
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
      await prisma.githubRepository.update({
        where: { id: `${PREFIX}-repository-c` },
        data: { teamId: null },
      });
      await prisma.team.delete({ where: { id: `${PREFIX}-team-c` } });
    }
  });

  it('공개 기여가 없는 사용자는 존재하지 않는 사용자와 동일하게 404(프로필 없음) 처리된다', async () => {
    const bystanderId = `${PREFIX}-bystander`;
    await prisma.user.create({
      data: {
        id: bystanderId,
        githubId: 8_800_999_000_001n,
        nickname: `${PREFIX}-bystander-login`,
        selectedMemberKind: MemberKind.STUDENT,
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
