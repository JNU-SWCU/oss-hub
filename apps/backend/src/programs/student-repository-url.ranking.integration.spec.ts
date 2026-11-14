import { ActivityVisibility } from '@prisma/client';
import { CollectionScheduleService } from '../github/collection-schedule.service';
import { RankingRepository } from '../ranking/ranking.repository';
import { RankingService } from '../ranking/ranking.service';
import { RankingYearService } from '../ranking/ranking-year.service';
import {
  teamId,
  githubId,
  input,
  oldId,
  prisma,
  programId,
  service,
  targetId,
} from './student-repository-url.integration.fixture';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { repositoryContributionTotals } from '../../test/ledger-contribution.fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

it('URL 교체로 옛 레포와 fact가 삭제돼도 공개·회원·교직원 랭킹과 월별 값은 보존된다', async () => {
  const originalUser = await prisma.user.findUniqueOrThrow({
    where: { githubId },
  });
  const actorLogin = `${teamId}-ranking-actor`;
  const peerGithubId = githubId + 900_000n;
  const staffGithubId = githubId + 900_001n;
  const rankingIds = [githubId, peerGithubId];
  const observedAt = new Date('2026-08-02T00:00:00Z');
  await prisma.user.update({
    where: { githubId },
    data: { nickname: actorLogin },
  });
  await prisma.user.createMany({
    data: [
      {
        githubId: peerGithubId,
        nickname: `${teamId}-ranking-peer`,
        type: 'STUDENT',
      },
      {
        githubId: staffGithubId,
        nickname: `${teamId}-ranking-staff`,
        type: 'STAFF',
        approvalStatus: 'APPROVED',
        name: 'Synthetic staff',
        department: 'Synthetic',
        departmentType: 'PROGRAM_OFFICE',
        profileCreatedAt: observedAt,
        profileUpdatedAt: observedAt,
      },
    ],
  });
  await prisma.githubUserActivityObservation.createMany({
    data: [
      {
        githubId,
        year: 2026,
        visibility: ActivityVisibility.PUBLIC,
        commitCount: 11,
        pullRequestCount: 3,
        issueCount: 2,
        repositoryCount: 2,
        starCount: 7,
        observedAt,
      },
      {
        githubId,
        year: 2026,
        visibility: ActivityVisibility.PRIVATE,
        commitCount: 5,
        pullRequestCount: 1,
        issueCount: 1,
        repositoryCount: 1,
        observedAt,
      },
      {
        githubId,
        year: 2025,
        visibility: ActivityVisibility.PUBLIC,
        commitCount: 4,
        pullRequestCount: 1,
        repositoryCount: 1,
        starCount: 3,
        observedAt,
      },
      {
        githubId: peerGithubId,
        year: 2026,
        visibility: ActivityVisibility.PUBLIC,
        commitCount: 40,
        observedAt,
      },
    ],
  });
  const rankingRepository = new RankingRepository(prisma);
  const ranking = new RankingService(
    rankingRepository,
    new RankingYearService(),
    new CollectionScheduleService(),
  );
  const readRankings = async () => {
    const pages = [];
    for (const year of [2026, 'all'] as const) {
      for (const viewer of [null, githubId, staffGithubId]) {
        const page = await ranking.findPage(year, 1, 100_000, viewer);
        expect(page.items).toHaveLength(page.total);
        const { nextCycleAt, ...snapshot } = page;
        expect(nextCycleAt).not.toBeNull();
        pages.push(snapshot);
      }
    }
    return {
      pages,
      monthly: [...(await rankingRepository.findMonthlySnapshots(2026))].sort(
        (left, right) =>
          left.githubId === right.githubId
            ? left.month - right.month
            : left.githubId < right.githubId
              ? -1
              : 1,
      ),
    };
  };
  try {
    const before = await readRankings();
    expect(before.pages.map((page) => page.viewerClass)).toEqual([
      'public',
      'member',
      'staff',
      'public',
      'member',
      'staff',
    ]);
    for (const page of before.pages) {
      const actor = page.items.find((item) => item.githubLogin === actorLogin);
      expect(actor).toMatchObject({
        commitCount: page.year === 2026 ? 16 : 20,
        pullRequestCount: page.year === 2026 ? 4 : 5,
        issueCount: 3,
        repositoryCount: page.year === 2026 ? 3 : 4,
        starCount: 7,
        total: page.year === 2026 ? 33 : 39,
      });
      expect(typeof actor?.previousRank).toBe('number');
    }
    expect(
      before.monthly.filter((row) => rankingIds.includes(row.githubId)),
    ).toHaveLength(2);
    expect(
      (await repositoryContributionTotals(prisma, [oldId])).commitCount,
    ).toBe(7);

    await service.updateMine(githubId, programId, input);

    expect(
      await prisma.githubRepository.findUnique({ where: { id: oldId } }),
    ).toBeNull();
    expect(
      (await repositoryContributionTotals(prisma, [oldId])).commitCount,
    ).toBe(0);
    expect(
      await prisma.githubRepository.findUnique({ where: { teamId } }),
    ).toMatchObject({ id: targetId });
    expect(await readRankings()).toEqual(before);
    console.info('URL_REPLACEMENT_RANKING', {
      pages: before.pages.length,
      comparedItems: before.pages.reduce(
        (sum, page) => sum + page.items.length,
        0,
      ),
      monthlyRows: before.monthly.length,
      unchanged: true,
    });
  } finally {
    await prisma.githubUserActivityObservation.deleteMany({
      where: { githubId: { in: rankingIds } },
    });
    await prisma.user.deleteMany({
      where: { githubId: { in: [peerGithubId, staffGithubId] } },
    });
    await prisma.user.update({
      where: { githubId },
      data: { nickname: originalUser.nickname },
    });
  }
});
