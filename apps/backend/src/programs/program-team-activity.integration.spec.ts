import { randomUUID } from 'node:crypto';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { ProgramTeamDeletionRepository } from './repository/program-team-deletion.repository';
import { ProgramTeamsRepository } from './repository/program-teams.repository';
import { ProgramTeamsService } from './service/program-teams.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const service = new ProgramTeamsService(
  new ProgramTeamsRepository(prisma),
  loadRuntimeConfig({ TEAM_JOIN_CODE_SECRET: 'synthetic-join-code-secret' }),
  new AuditLogService(new AuditLogRepository(prisma)),
  new ProgramTeamDeletionRepository(prisma),
);
const prefix = `team-activity-${randomUUID()}`;
const base = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`);
const programId = `${prefix}-program`;
const teamId = `${prefix}-team`;
const applicationId = `${prefix}-application`;
const repositoryA = `${prefix}-a`;
const repositoryB = `${prefix}-b`;
const people = {
  leader: { id: `${prefix}-leader`, githubId: base, nickname: 'lead-now' },
  quiet: { id: `${prefix}-quiet`, githubId: base + 1n, nickname: 'quiet' },
  issuer: { id: `${prefix}-issuer`, githubId: base + 2n, nickname: 'issuer' },
  outsider: { id: `${prefix}-out`, githubId: base + 3n, nickname: 'outsider' },
  staff: { id: `${prefix}-staff`, githubId: base + 4n, nickname: 'staff' },
};

const duringProgram = new Date('2026-08-15T00:00:00Z');
const emptyMembers = [
  ['leader', 'lead-now'],
  ['quiet', 'quiet'],
  ['issuer', 'issuer'],
].map(([key, githubLogin]) => ({
  userId: `${prefix}-${key}`,
  githubLogin,
  totals: { commitCount: 0, pullRequestCount: 0, issueCount: 0 },
  points: [],
}));

beforeAll(async () => {
  await prisma.$connect();
  await prisma.user.createMany({
    data: Object.values(people).map((person) => ({
      ...person,
      hasStaffAccess: person === people.staff,
    })),
  });
  await prisma.program.create({
    data: {
      id: programId,
      name: 'Synthetic program',
      organizer: 'Synthetic',
      category: 'BASIC',
      applicationTemplateKey: 'synthetic',
      applicationTemplateVersion: 1,
      description: 'Synthetic',
      applicationStartAt: new Date('2026-07-01Z'),
      applicationEndAt: new Date('2026-07-31Z'),

      startAt: new Date('2026-07-31T15:00:00Z'),
      endAt: new Date('2026-08-31T14:59:59Z'),
    },
  });
  await prisma.team.create({
    data: {
      id: teamId,
      programId,
      name: 'Synthetic team',
      joinCodeDigest: prefix,
      leaderId: people.leader.id,
    },
  });
  await prisma.teamMember.createMany({
    data: [people.leader, people.quiet, people.issuer].map((person, index) => ({
      teamId,
      programId,
      userId: person.id,
      createdAt: new Date(Date.UTC(2026, 6, 1, 0, index)),
    })),
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId,
      teamId,
      applicantId: people.leader.id,
      status: 'APPROVED',
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
  await prisma.githubRepository.createMany({
    data: [
      {
        id: repositoryA,
        githubRepositoryId: base + 100n,
        nameWithOwner: 'synthetic/a',
        source: 'ORG_PROVISIONED',
        programId,
        teamId,
        lastSuccessAt: new Date('2026-08-20Z'),
      },
      {
        id: repositoryB,
        githubRepositoryId: base + 101n,
        nameWithOwner: 'synthetic/b',
        source: 'EXTERNAL_PUBLIC',
        applicationId,
        programId,
        teamId,
      },
    ],
  });
  await prisma.contribution.create({
    data: {
      repositoryId: repositoryA,
      githubId: people.leader.githubId,
      date: new Date('2026-08-02Z'),
      commitCount: 900,
      issueCount: 90,
    },
  });
});
afterAll(async () => {
  await prisma.$disconnect();
});

it('A→B 직후 B가 아직 수집 전이면 NOT_COLLECTED이고 A의 행도 0 점도 싣지 않는다', async () => {
  const activity = await service.getActivity(
    people.leader.githubId,
    programId,
    teamId,
    duringProgram,
  );

  expect(activity).toEqual({
    applicationId,
    repository: { id: repositoryB, url: 'https://github.com/synthetic/b' },
    status: 'NOT_COLLECTED',
    lastSuccessAt: null,
    window: { from: '2026-08-01', to: '2026-08-31', timeZone: 'Asia/Seoul' },
    canEditRepositoryUrl: true,
    members: emptyMembers,
  });
});

describe('B가 수집된 뒤', () => {
  beforeAll(async () => {
    await prisma.githubRepository.update({
      where: { id: repositoryB },
      data: { lastSuccessAt: new Date('2026-08-20T01:00:00Z') },
    });
    await prisma.contribution.createMany({
      data: [
        {
          githubId: people.leader.githubId,
          date: '2026-07-31',
          commitCount: 50,
        },
        {
          githubId: people.leader.githubId,
          date: '2026-08-01',
          commitCount: 2,
          pullRequestCount: 1,
        },
        {
          githubId: people.leader.githubId,
          date: '2026-08-31',
          commitCount: 4,
        },
        {
          githubId: people.leader.githubId,
          date: '2026-09-01',
          commitCount: 70,
        },

        {
          githubId: people.leader.githubId,
          date: '2026-08-10',
          releaseCount: 1,
        },
        { githubId: people.issuer.githubId, date: '2026-08-05', issueCount: 3 },

        {
          githubId: people.outsider.githubId,
          date: '2026-08-05',
          commitCount: 7,
        },
      ].map(({ date, ...row }) => ({
        ...row,
        repositoryId: repositoryB,
        date: new Date(`${date}T00:00:00Z`),
      })),
    });
  });

  const leaderPoints = [
    { date: '2026-08-01', commitCount: 2, pullRequestCount: 1, issueCount: 0 },
    { date: '2026-08-31', commitCount: 4, pullRequestCount: 0, issueCount: 0 },
  ];
  const collectedMembers = [
    {
      ...emptyMembers[0],
      totals: { commitCount: 6, pullRequestCount: 1, issueCount: 0 },
      points: leaderPoints,
    },
    emptyMembers[1],
    {
      ...emptyMembers[2],
      totals: { commitCount: 0, pullRequestCount: 0, issueCount: 3 },
      points: [
        {
          date: '2026-08-05',
          commitCount: 0,
          pullRequestCount: 0,
          issueCount: 3,
        },
      ],
    },
  ];

  it('서울 기간 안의 지금 팀원 행만 날짜별로 싣고 행이 없는 팀원도 남긴다', async () => {
    const activity = await service.getActivity(
      people.leader.githubId,
      programId,
      teamId,
      duringProgram,
    );

    expect(activity).toMatchObject({
      status: 'COLLECTED',
      lastSuccessAt: '2026-08-20T01:00:00.000Z',
      members: collectedMembers,
    });
  });

  it('팀원·교직원은 canEditRepositoryUrl 말고 같은 값을 받고 팀 밖 학생은 404다', async () => {
    const leader = await service.getActivity(
      people.leader.githubId,
      programId,
      teamId,
      duringProgram,
    );

    const [quiet, staff] = await Promise.all(
      [people.quiet, people.staff].map((person) =>
        service.getActivity(person.githubId, programId, teamId, duringProgram),
      ),
    );

    expect(quiet).toEqual({ ...leader, canEditRepositoryUrl: false });
    expect(staff).toEqual(leader);
    await expect(
      service.getActivity(
        people.outsider.githubId,
        programId,
        teamId,
        duringProgram,
      ),
    ).rejects.toMatchObject({ errorCode: { code: 'TEAM_010' } });
  });

  it('수집이 실패 중이어도 마지막으로 끝낸 값을 그대로 싣는다', async () => {
    await prisma.githubRepository.update({
      where: { id: repositoryB },
      data: { failureCount: 2 },
    });

    const activity = await service.getActivity(
      people.staff.githubId,
      programId,
      teamId,
      duringProgram,
    );

    expect(activity).toMatchObject({
      status: 'ERROR',
      members: collectedMembers,
    });
    await prisma.githubRepository.update({
      where: { id: repositoryB },
      data: { failureCount: 0 },
    });
  });

  it('끝나는 날을 정하지 않은 프로그램은 센티널 창을 그대로 싣고 시작 뒤의 날을 모두 싣는다', async () => {
    await prisma.program.update({
      where: { id: programId },
      data: { endAt: new Date('9999-12-31T23:59:59.999Z') },
    });

    const activity = await service.getActivity(
      people.leader.githubId,
      programId,
      teamId,
    );

    expect(activity.window).toEqual({
      from: '2026-08-01',
      to: '+010000-01-01',
      timeZone: 'Asia/Seoul',
    });
    expect(activity.members[0]?.points.map((point) => point.date)).toEqual([
      '2026-08-01',
      '2026-08-31',
      '2026-09-01',
    ]);
    await prisma.program.update({
      where: { id: programId },
      data: { endAt: new Date('2026-08-31T14:59:59Z') },
    });
  });
});

it('변경 이력은 옛 연결 기록과 새 URL 기록을 한 시간순 커서로 함께 넘긴다', async () => {
  const legacyMetadata = {
    schemaVersion: 1,
    applicationId,
    before: {
      repositoryId: null,
      nameWithOwner: null,
      connectionMode: 'NEW',
      repositoryUrl: null,
    },
    after: {
      repositoryId: repositoryA,
      nameWithOwner: 'synthetic/a',
      connectionMode: 'NEW',
      repositoryUrl: null,
    },
  };
  await prisma.auditLog.createMany({
    data: [
      {
        id: `${prefix}-connected`,
        actorId: people.staff.id,
        action: 'REPOSITORY_CONNECTION_CHANGED',
        targetType: 'APPLICATION',
        targetId: applicationId,
        occurredAt: new Date('2026-08-02T00:00:00Z'),
        metadata: legacyMetadata,
      },
      {
        id: `${prefix}-relinked`,
        actorId: people.leader.id,
        action: 'APPLICATION_REPOSITORY_URL_CHANGED',
        targetType: 'APPLICATION',
        targetId: applicationId,
        occurredAt: new Date('2026-08-10T00:00:00Z'),
        metadata: {
          schemaVersion: 2,
          programId,
          teamId,
          programName: 'Synthetic program',
          actorGithubLogin: 'lead-at-change',
          before: {
            repositoryId: repositoryA,
            repositoryUrl: 'https://github.com/synthetic/a',
          },
          after: {
            repositoryId: repositoryB,
            repositoryUrl: 'https://github.com/synthetic/b',
          },
        },
      },

      {
        id: `${prefix}-foreign`,
        actorId: people.staff.id,
        action: 'REPOSITORY_CONNECTION_CHANGED',
        targetType: 'APPLICATION',
        targetId: applicationId,
        occurredAt: new Date('2026-08-05T00:00:00Z'),
        metadata: { ...legacyMetadata, applicationId: `${prefix}-other` },
      },
      {
        id: `${prefix}-submitted`,
        actorId: people.leader.id,
        action: 'APPLICATION_SUBMITTED',
        targetType: 'APPLICATION',
        targetId: applicationId,
        occurredAt: new Date('2026-08-06T00:00:00Z'),
        metadata: {},
      },
    ],
  });

  const first = await service.getRepositoryUrlHistory(
    people.quiet.githubId,
    programId,
    teamId,
  );
  const afterNewest = await service.getRepositoryUrlHistory(
    people.quiet.githubId,
    programId,
    teamId,
    { occurredAt: new Date('2026-08-10T00:00:00Z'), id: `${prefix}-relinked` },
  );

  const connected = {
    id: `${prefix}-connected`,
    occurredAt: '2026-08-02T00:00:00.000Z',
    actorGithubLogin: 'staff',
    previousRepositoryUrl: null,
    newRepositoryUrl: 'https://github.com/synthetic/a',
  };
  expect(first).toEqual({
    items: [
      {
        id: `${prefix}-relinked`,
        occurredAt: '2026-08-10T00:00:00.000Z',
        actorGithubLogin: 'lead-at-change',
        previousRepositoryUrl: 'https://github.com/synthetic/a',
        newRepositoryUrl: 'https://github.com/synthetic/b',
      },
      connected,
    ],
    nextCursor: null,
  });
  expect(afterNewest).toEqual({ items: [connected], nextCursor: null });
});
