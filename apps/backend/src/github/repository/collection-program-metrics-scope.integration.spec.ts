import { ProgramCategory, PrismaClient } from '@prisma/client';

import { CollectionReadService } from './collection-read.service';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import type { PrismaService } from '../../prisma/prisma.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

describe('② 프로그램 지표는 연결된 저장소만 센다 (실 Postgres)', () => {
  const prisma = new PrismaClient();
  const service = new CollectionReadService(prisma as unknown as PrismaService);

  const PREFIX = 'program-scope';
  const PROGRAM_ID = `${PREFIX}-program`;
  const TEAM_ID = `${PREFIX}-team`;
  const LEADER_ID = `${PREFIX}-leader`;

  const PROGRAM_REPO_ID = `${PREFIX}-repo-program`;
  const TEAM_REPO_ID = `${PREFIX}-repo-team`;
  const UNLINKED_REPO_ID = `${PREFIX}-repo-unlinked`;

  const PROGRAM_GITHUB_REPO = 9_950_000_001n;
  const TEAM_GITHUB_REPO = 9_950_000_002n;
  const UNLINKED_GITHUB_REPO = 9_950_000_003n;

  const CONTRIBUTOR = 9_960_000_001n;
  const YEAR = 2026;

  const CONTRIBUTION_DATE = new Date('2026-06-01T00:00:00.000Z');

  const allGithubRepositoryIds = [
    PROGRAM_GITHUB_REPO,
    TEAM_GITHUB_REPO,
    UNLINKED_GITHUB_REPO,
  ];

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.contribution.deleteMany({
      where: {
        repositoryId: { in: [PROGRAM_REPO_ID, TEAM_REPO_ID, UNLINKED_REPO_ID] },
      },
    });
    await prisma.githubRepository.deleteMany({
      where: { githubRepositoryId: { in: allGithubRepositoryIds } },
    });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [LEADER_ID, `${PREFIX}-user`] } },
    });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.contribution.deleteMany({
      where: {
        repositoryId: { in: [PROGRAM_REPO_ID, TEAM_REPO_ID, UNLINKED_REPO_ID] },
      },
    });
    await prisma.githubRepository.deleteMany({
      where: { githubRepositoryId: { in: allGithubRepositoryIds } },
    });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [LEADER_ID, `${PREFIX}-user`] } },
    });

    await prisma.user.create({
      data: {
        id: LEADER_ID,
        githubId: 9_960_000_900n,
        nickname: `${PREFIX}-leader-login`,
      },
    });
    await prisma.user.create({
      data: {
        id: `${PREFIX}-user`,
        githubId: CONTRIBUTOR,
        nickname: `${PREFIX}-contributor`,
      },
    });

    await prisma.program.create({
      data: {
        id: PROGRAM_ID,
        name: `${PREFIX} 프로그램`,
        organizer: `${PREFIX} 주관`,
        trackType: 'CURRICULAR',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'capstone-v1',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
        description: `${PREFIX} 설명`,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        programId: PROGRAM_ID,
        name: `${PREFIX} 팀`,
        joinCodeDigest: `${PREFIX}-join-code-digest`,
        leaderId: LEADER_ID,
      },
    });

    const baseRepository = {
      source: 'ORG_PROVISIONED' as const,
      visibility: 'PUBLIC' as const,
      presence: 'PRESENT' as const,
      lastCompleteInventoryObservedAt: new Date('2026-06-02T00:00:00.000Z'),
    };
    await prisma.githubRepository.create({
      data: {
        ...baseRepository,
        id: PROGRAM_REPO_ID,
        githubRepositoryId: PROGRAM_GITHUB_REPO,
        nameWithOwner: `${PREFIX}/linked-by-program`,
        programId: PROGRAM_ID,
      },
    });
    await prisma.githubRepository.create({
      data: {
        ...baseRepository,
        id: TEAM_REPO_ID,
        githubRepositoryId: TEAM_GITHUB_REPO,
        nameWithOwner: `${PREFIX}/linked-by-team`,
        teamId: TEAM_ID,
      },
    });
    await prisma.githubRepository.create({
      data: {
        ...baseRepository,
        id: UNLINKED_REPO_ID,
        githubRepositoryId: UNLINKED_GITHUB_REPO,
        nameWithOwner: `${PREFIX}/unlinked-dev-repo`,
      },
    });

    await prisma.contribution.createMany({
      data: [
        {
          repositoryId: PROGRAM_REPO_ID,
          githubId: CONTRIBUTOR,
          date: CONTRIBUTION_DATE,
          commitCount: 3,
          pullRequestCount: 2,
          releaseCount: 1,
        },
        {
          repositoryId: TEAM_REPO_ID,
          githubId: CONTRIBUTOR,
          date: CONTRIBUTION_DATE,
          commitCount: 5,
          pullRequestCount: 4,
          releaseCount: 7,
        },
        {
          repositoryId: UNLINKED_REPO_ID,
          githubId: CONTRIBUTOR,
          date: CONTRIBUTION_DATE,
          commitCount: 100,
          pullRequestCount: 200,
          releaseCount: 300,
        },
      ],
    });
  });

  it('미연결 저장소의 기여 행이 DB 에 실제로 존재한다 (필터가 아니라 데이터가 있음을 고정)', async () => {
    const unlinked = await prisma.githubRepository.findUniqueOrThrow({
      where: { githubRepositoryId: UNLINKED_GITHUB_REPO },
      select: { id: true, source: true, programId: true, teamId: true },
    });
    expect(unlinked.source).toBe('ORG_PROVISIONED');
    expect(unlinked.programId).toBeNull();
    expect(unlinked.teamId).toBeNull();

    const rows = await prisma.contribution.findMany({
      where: { repositoryId: UNLINKED_REPO_ID },
      select: { commitCount: true, pullRequestCount: true, releaseCount: true },
    });
    expect(rows).toEqual([
      { commitCount: 100, pullRequestCount: 200, releaseCount: 300 },
    ]);
  });

  it('getContributorMetrics 는 program/team 연결 저장소만 합산하고 미연결은 제외한다', async () => {
    const metrics = await service.getContributorMetrics({
      repositoryIds: allGithubRepositoryIds,
      year: YEAR,
    });

    const byRepository = new Map(metrics.map((row) => [row.repositoryId, row]));

    expect(byRepository.get(PROGRAM_GITHUB_REPO)).toEqual(
      expect.objectContaining({
        githubUserId: CONTRIBUTOR,
        githubLogin: `${PREFIX}-contributor`,
        commitCount: 3,
        pullRequestCount: 2,

        releaseCount: 1,
      }),
    );
    expect(byRepository.get(TEAM_GITHUB_REPO)).toEqual(
      expect.objectContaining({
        commitCount: 5,
        pullRequestCount: 4,
        releaseCount: 7,
      }),
    );

    expect(byRepository.has(UNLINKED_GITHUB_REPO)).toBe(false);

    const totals = metrics.reduce(
      (accumulator, row) => ({
        commitCount: accumulator.commitCount + row.commitCount,
        pullRequestCount: accumulator.pullRequestCount + row.pullRequestCount,
        releaseCount: accumulator.releaseCount + row.releaseCount,
      }),
      { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
    );
    expect(totals).toEqual({
      commitCount: 8,
      pullRequestCount: 6,
      releaseCount: 8,
    });
  });

  it('연결이 끊기면 그 저장소의 기여는 다음 조회에서 곧바로 빠진다 (캐시된 지표가 필터를 우회하지 않는다)', async () => {
    const before = await service.getContributorMetrics({
      repositoryIds: allGithubRepositoryIds,
      year: YEAR,
    });
    expect(before.map((row) => row.repositoryId).sort()).toEqual(
      [PROGRAM_GITHUB_REPO, TEAM_GITHUB_REPO].sort(),
    );

    await prisma.githubRepository.update({
      where: { githubRepositoryId: PROGRAM_GITHUB_REPO },
      data: { programId: null },
    });

    const after = await service.getContributorMetrics({
      repositoryIds: allGithubRepositoryIds,
      year: YEAR,
    });

    expect(
      await prisma.contribution.count({
        where: { repositoryId: PROGRAM_REPO_ID },
      }),
    ).toBe(1);
    expect(after.map((row) => row.repositoryId)).toEqual([TEAM_GITHUB_REPO]);
  });

  it('연결 저장소에 기여가 하나도 없으면 0 을 낸다 — 미연결 수치로 메우지 않는다', async () => {
    await prisma.contribution.deleteMany({
      where: { repositoryId: { in: [PROGRAM_REPO_ID, TEAM_REPO_ID] } },
    });

    expect(
      await prisma.contribution.count({
        where: { repositoryId: UNLINKED_REPO_ID },
      }),
    ).toBe(1);

    const metrics = await service.getContributorMetrics({
      repositoryIds: allGithubRepositoryIds,
      year: YEAR,
    });

    expect(metrics).toEqual([]);
  });
});
