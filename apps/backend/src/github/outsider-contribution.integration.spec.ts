import { randomUUID } from 'node:crypto';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';

/**
 * 「팀원이 아닌 사람의 기여」(#1133)의 수집 쪽 저장 경로 — 센 기준(연결된 프로그램의 기간), ADR-009
 * `전체 − 팀원합`의 팀원합, 저장소마다 한 행 덮어쓰기를 실제 DB로 본다.
 */
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const collection = new CollectionIncrementalRepository(prisma);
const scope = `outsider-${randomUUID()}`;
const memberGithubId = BigInt(
  `0x${randomUUID().replaceAll('-', '').slice(0, 12)}`,
);
const ids = {
  member: `${scope}-member`,
  program: `${scope}-program`,
  team: `${scope}-team`,
  application: `${scope}-application`,
  linked: `${scope}-linked`,
  detached: `${scope}-detached`,
};
const startAt = new Date('2026-07-31T15:00:00Z');
const endAt = new Date('2026-08-31T14:59:59Z');

beforeAll(async () => {
  await prisma.$connect();
  await prisma.user.create({
    data: {
      id: ids.member,
      githubId: memberGithubId,
      nickname: 'synthetic-outsider-member',
    },
  });
  await prisma.program.create({
    data: {
      id: ids.program,
      name: 'Synthetic program',
      organizer: 'Synthetic',
      category: 'BASIC',
      applicationTemplateKey: 'synthetic',
      applicationTemplateVersion: 1,
      description: 'Synthetic',
      applicationStartAt: new Date('2026-07-01Z'),
      applicationEndAt: new Date('2026-07-31Z'),
      startAt,
      endAt,
    },
  });
  await prisma.team.create({
    data: {
      id: ids.team,
      programId: ids.program,
      name: 'Synthetic team',
      joinCodeDigest: scope,
      leaderId: ids.member,
    },
  });
  await prisma.teamMember.create({
    data: { teamId: ids.team, programId: ids.program, userId: ids.member },
  });
  await prisma.application.create({
    data: {
      id: ids.application,
      programId: ids.program,
      teamId: ids.team,
      applicantId: ids.member,
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
  await prisma.githubRepository.createMany({
    data: [
      {
        id: ids.linked,
        githubRepositoryId: memberGithubId + 1n,
        nameWithOwner: 'synthetic/outsider-linked',
        source: 'EXTERNAL_PUBLIC',
        applicationId: ids.application,
        programId: ids.program,
        teamId: ids.team,
      },
      {
        id: ids.detached,
        githubRepositoryId: memberGithubId + 2n,
        nameWithOwner: 'synthetic/outsider-detached',
        source: 'ORG_PROVISIONED',
        programId: ids.program,
        teamId: ids.team,
      },
    ],
  });
});
afterAll(async () => {
  // The isolated runner removes the database.
  await prisma.$disconnect();
});

it('counts against the linked program window and not for a detached repository', async () => {
  expect(await collection.findOutsiderCountingWindow(ids.linked)).toEqual({
    applicationId: ids.application,
    programId: ids.program,
    startAt,
    endAt,
    countedThrough: null,
  });
  expect(await collection.findOutsiderCountingWindow(ids.detached)).toBeNull();
  expect(
    await collection.findOutsiderCountingWindow(`${scope}-missing`),
  ).toBeNull();
});

it('counts the team side of `outsiders = total − team` from current members inside the window', async () => {
  await prisma.collectionCommitFact.createMany({
    data: [
      {
        sha: `${scope}-in-1`,
        committedAt: new Date('2026-08-01T00:00:00Z'),
        authorGithubId: memberGithubId,
      },
      {
        sha: `${scope}-in-2`,
        committedAt: endAt,
        authorGithubId: memberGithubId,
      },
      {
        sha: `${scope}-before`,
        committedAt: new Date('2026-07-31T14:59:59Z'),
        authorGithubId: memberGithubId,
      },
      {
        sha: `${scope}-outsider`,
        committedAt: new Date('2026-08-02T00:00:00Z'),
        authorGithubId: memberGithubId + 99n,
      },
    ].map((row) => ({ ...row, repositoryId: ids.linked })),
  });
  expect(
    await collection.countTeamCommitsBetween(
      ids.linked,
      [memberGithubId],
      startAt,
      endAt,
    ),
  ).toBe(2);
  expect(
    await collection.countTeamCommitsBetween(ids.linked, [], startAt, endAt),
  ).toBe(0);
});

it('keeps one row per repository, overwritten by each count', async () => {
  const base = {
    repositoryId: ids.linked,
    applicationId: ids.application,
    programId: ids.program,
    windowStartAt: startAt,
    windowEndAt: endAt,
    observedAt: new Date('2026-09-01T00:00:00Z'),
  };
  await collection.saveOutsiderContribution({
    ...base,
    commitCount: 9,
    pullRequestCount: 9,
    issueCount: 9,
  });
  await collection.saveOutsiderContribution({
    ...base,
    commitCount: 3,
    pullRequestCount: 1,
    issueCount: 2,
  });
  expect(
    await prisma.githubRepositoryOutsiderContribution.findMany({
      where: { repositoryId: ids.linked },
    }),
  ).toEqual([
    expect.objectContaining({
      ...base,
      commitCount: 3,
      pullRequestCount: 1,
      issueCount: 2,
    }),
  ]);
});

it('remembers when it last counted only while the application and window stay the same', async () => {
  const observedAt = new Date('2026-09-02T00:00:00Z');
  await collection.saveOutsiderContribution({
    repositoryId: ids.linked,
    applicationId: ids.application,
    programId: ids.program,
    windowStartAt: startAt,
    windowEndAt: endAt,
    commitCount: 0,
    pullRequestCount: 0,
    issueCount: 0,
    observedAt,
  });
  expect(
    (await collection.findOutsiderCountingWindow(ids.linked))?.countedThrough,
  ).toEqual(observedAt);

  // Counted for another team's application (the repository was relinked) — count again from scratch.
  await prisma.githubRepositoryOutsiderContribution.update({
    where: { repositoryId: ids.linked },
    data: { applicationId: `${scope}-previous-application` },
  });
  expect(
    (await collection.findOutsiderCountingWindow(ids.linked))?.countedThrough,
  ).toBeNull();
});
