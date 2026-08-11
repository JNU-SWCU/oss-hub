import {
  ApplicationStatus,
  CollectionRepositoryPresence,
  ProgramCategory,
  RepositorySource,
  RepositoryVisibility,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../../test/integration-database.guard';
import { createCollectionReadPortForIntegrationTest } from '../../../github/collection-read.port';
import { PrismaService } from '../../../prisma/prisma.service';
import { loadRuntimeConfig } from '../../../runtime-config/runtime-config';
import { PublicEligibilityService } from '../public-eligibility/public-eligibility.service';
import { PublicUserProfileResponseDto } from './dto/public-user-profile-response.dto';
import { PublicProjectsRepository } from './public-projects.repository';
import { PublicProjectsService } from './public-projects.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

/** QA40 — 커서 암호화 키 파생용 합성 값. 실 배포 시크릿과 무관하다. */
const SYNTHETIC_SESSION_SECRET = Buffer.from(
  'synthetic-public-projects-integration-secret',
).toString('base64url');

const prisma = new PrismaService();
const collectionReadService =
  createCollectionReadPortForIntegrationTest(prisma);
const eligibilityService = new PublicEligibilityService(collectionReadService);
const publicProjectsRepository = new PublicProjectsRepository(prisma);
const service = new PublicProjectsService(
  publicProjectsRepository,
  eligibilityService,
  collectionReadService,
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
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'synthetic-template',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
        description: 'synthetic-description',
      },
    });

    // 프로필 소유자 — UserProfile(name/studentId/department)까지 함께 심어서 이 값들이
    // 응답에 절대 새지 않는다는 걸 증명한다.
    await prisma.user.create({
      data: {
        id: OWNER_ID,
        githubId: OWNER_GITHUB_ID,
        nickname: `${PREFIX}-owner-login`,
        avatarUrl: `https://avatars.githubusercontent.com/u/${PREFIX}-owner-avatar`,
        role: Role.STUDENT,
        profile: {
          create: {
            name: 'synthetic-real-name',
            studentId: `${PREFIX}-student-id`,
            department: 'synthetic-department',
          },
        },
      },
    });

    // repo-a/repo-b: 소유자 기여가 있는 두 저장소(합산 정확성 검증용). repo-a에는 다른
    // 기여자(OTHER_CONTRIBUTOR_GITHUB_ID)의 기여도 함께 심어 소유자 지표에 섞이지 않음을 본다.
    // repo-c: eligible이지만 collection이 아직 관측하지 않은 저장소(unobserved).
    // repo-d: collection이 관측했지만 소유자의 기여 행이 없는 저장소(observed-zero).
    const repoKeys = ['a', 'b', 'c', 'd'] as const;
    const applicantIds = repoKeys.map((key) => `${PREFIX}-applicant-${key}`);
    await prisma.user.createMany({
      data: repoKeys.map((key, index) => ({
        id: `${PREFIX}-applicant-${key}`,
        githubId: 8_800_000_001_000n + BigInt(index),
        nickname: `${PREFIX}-applicant-${key}`,
        role: Role.STUDENT,
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
    };
    // #617 단계 D 이후 platform(옛 Repository)과 collection 관측(옛 CollectionRepository)이
    // 한 GithubRepository 행이다 — 더는 같은 githubRepositoryId를 공유하는 두 행을 따로 만들
    // 수 없다(만들면 githubRepositoryId @unique 위반). repo-a/b/d는 관측됨(presence: PRESENT +
    // lastCompleteInventoryObservedAt), repo-c는 미관측을 나타내려고 presence: ABSENT로 만든다 —
    // `getRepositoryCumulativeMetrics`가 presence: PRESENT만 보므로 이 한 컬럼 차이가
    // "관측-0(d)"과 "미관측(c)"을 여전히 구분 가능하게 한다.
    const observedKeys = ['a', 'b', 'd'] as const;
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
          : { presence: CollectionRepositoryPresence.ABSENT }),
      })),
    });

    // 소유자를 세 저장소(a/b/d)의 팀 리더로 묶어 listForUser가 이 저장소들을 찾게 한다.
    for (const key of observedKeys) {
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

    // repo-a: 소유자 기여(3/1/0) + 다른 기여자(999/999/999, 반드시 배제되어야 한다).
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
    // repo-b: 소유자 기여(4/0/2) — 두 저장소 합산 정확성 검증용.
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
    // repo-d: 관측은 됐지만(연간 집계 행은 있으나) 소유자의 기여 행은 없다 — observed-zero.
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
      // Application.teamId / GithubRepository.teamId가 Team을 참조하므로(RESTRICT)
      // repository·application을 team보다 먼저 지운다.
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
      '관측-0(d)과 미관측(c)이 서로 다르게 표현된다',
    async () => {
      const result = await service.findProfile(OWNER_ID);

      expect(result.identity.githubNickname).toBe(`${PREFIX}-owner-login`);
      expect(result.projects).toHaveLength(3);

      const byKey = new Map(
        result.projects.map((project) => [project.row.id, project]),
      );
      const repoA = byKey.get(`${PREFIX}-repository-a`);
      const repoB = byKey.get(`${PREFIX}-repository-b`);
      const repoC = byKey.get(`${PREFIX}-repository-c`);
      const repoD = byKey.get(`${PREFIX}-repository-d`);

      // repo-a: 소유자 기여만 보이고, 다른 기여자의 999 값은 절대 섞이지 않는다.
      expect(repoA?.observed).toBe(true);
      expect(repoA?.metrics).toEqual({
        commitCount: 3,
        pullRequestCount: 1,
        releaseCount: 0,
      });

      expect(repoB?.observed).toBe(true);
      expect(repoB?.metrics).toEqual({
        commitCount: 4,
        pullRequestCount: 0,
        releaseCount: 2,
      });

      // repo-c는 애초에 listForUser 결과에 없다(팀 멤버로 묶지 않았다) — 그래서
      // byKey에 존재하지 않는다는 사실 자체가 "이 사용자와 무관"임을 보여준다.
      expect(repoC).toBeUndefined();

      // repo-d: collection이 관측은 했으나(observed: true) 소유자의 기여 행이 없어 0값이다 —
      // "관측했지만 0"과 "미관측"이 서로 다른 상태임을 보여준다.
      expect(repoD?.observed).toBe(true);
      expect(repoD?.metrics).toEqual({
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
      });
      expect(repoD?.dataAsOf).not.toBeNull();

      // 두 저장소(a/b) 합산 — 다른 기여자의 활동이나 observed-zero 저장소는 포함하지 않는다.
      expect(result.observedTotals).toEqual({
        commitCount: 7,
        pullRequestCount: 1,
        releaseCount: 2,
      });
    },
  );

  it('unobserved 저장소를 사용자 목록에 포함시키면 observed:false, dataAsOf:null, metrics:null로 표현된다', async () => {
    // repo-c도 소유자와 연결해 unobserved 케이스를 직접 확인한다.
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
      expect(repoC?.dataAsOf).toBeNull();
      expect(repoC?.metrics).toBeNull();
    } finally {
      // GithubRepository.teamId가 team-c를 참조하므로(RESTRICT) team 삭제 전 연결부터 끊는다.
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
        role: Role.STUDENT,
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
