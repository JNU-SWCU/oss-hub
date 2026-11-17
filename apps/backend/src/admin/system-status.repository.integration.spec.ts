import { PlatformRepository } from '../platform/platform.repository';
import { CollectionScheduleService } from '../github/collection-schedule.service';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { unlinkRepo } from '../../test/repo-ledger.fixture';
import {
  prisma,
  service,
  githubId,
  programId,
  teamId,
  oldGithubId,
  input,
} from '../programs/student-repository-url.integration.fixture';
import { SystemStatusRepository } from './system-status.repository';
import { SystemStatusService } from './system-status.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const status = new SystemStatusRepository(prisma, new PlatformRepository());
const statusService = new SystemStatusService(
  status,
  () => new Date(),
  new CollectionScheduleService(),
);
const ADMIN_ID = 'synthetic-system-status-admin';
const ADMIN_GITHUB_ID = 9_517_000_000_001n;

beforeAll(async () => {
  await prisma.user.upsert({
    where: { id: ADMIN_ID },
    update: {},
    create: {
      id: ADMIN_ID,
      githubId: ADMIN_GITHUB_ID,
      nickname: 'synthetic-system-status-admin',
      admin: { create: { origin: 'BOOTSTRAP' } },
      accountStatus: 'ACTIVE',
    },
  });
  await prisma.user.createMany({
    data: [SELF_SUBJECT_ID, OFF_HOURS_SUBJECT_ID].map((id, index) => ({
      id,
      githubId: 9_517_000_000_002n + BigInt(index),
      nickname: id,
    })),
  });
});
const HISTORY_TEAM_ID = 'synthetic-system-status-history-team';
const HISTORY_PROGRAM_ID = 'synthetic-system-status-history-program';
const MAIL_TYPE = 'SYNTHETIC_SYSTEM_STATUS_MAIL';
const SELF_SUBJECT_ID = 'synthetic-system-status-self-subject';
const OFF_HOURS_SUBJECT_ID = 'synthetic-system-status-off-hours-subject';
const HOUR_MS = 60 * 60_000;

async function clearSeededSignals(): Promise<void> {
  await prisma.teamHistory.deleteMany({ where: { teamId: HISTORY_TEAM_ID } });
  await prisma.programHistory.deleteMany({
    where: { programId: HISTORY_PROGRAM_ID },
  });
  await prisma.notification.deleteMany({ where: { type: MAIL_TYPE } });
}

function koreaNoonWithinLastWeek(now: Date, weekend: boolean): Date {
  for (let daysAgo = 1; daysAgo <= 6; daysAgo += 1) {
    const kstDay = new Date(
      now.getTime() + 9 * HOUR_MS - daysAgo * 24 * HOUR_MS,
    );
    const day = kstDay.getUTCDay();
    if ((day === 0 || day === 6) === weekend) {
      return new Date(
        Date.UTC(
          kstDay.getUTCFullYear(),
          kstDay.getUTCMonth(),
          kstDay.getUTCDate(),
          3,
        ),
      );
    }
  }
  throw new Error('a week always has weekend and weekday days');
}

async function seedAdminChange(
  userId: string,
  occurredAt: Date,
  actorId: string | null,
) {
  await prisma.adminHistory.create({
    data: {
      userId,
      actorId,
      event: 'GRANTED',
      occurredAt,
      source: 'APPLICATION',
      data: {},
    },
  });
}

function teamHistoryData(event: 'REJECTED' | 'DELETED' | 'APPROVED') {
  return event === 'DELETED'
    ? {
        schemaVersion: 1,
        name: 'Synthetic team',
        members: [],
        deletedCounts: {},
      }
    : { schemaVersion: 1, revision: 1, rejectionReason: null };
}

async function seedTeamRemovals(count: number, start: Date, spacingMs: number) {
  await prisma.teamHistory.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      teamId: HISTORY_TEAM_ID,
      programId: HISTORY_PROGRAM_ID,
      actorId: ADMIN_ID,
      event: 'REJECTED' as const,
      occurredAt: new Date(start.getTime() + index * spacingMs),
      source: 'APPLICATION' as const,
      data: teamHistoryData('REJECTED'),
    })),
  });
}

async function anomaliesFor(userId: string) {
  const { anomalies } = await statusService.getStatus();
  return anomalies.filter((anomaly) => anomaly.target?.id === userId);
}

afterEach(clearSeededSignals);
afterAll(async () => {
  await clearSeededSignals();
  await prisma.admin.deleteMany({ where: { userId: ADMIN_ID } });
  await prisma.user.deleteMany({ where: { id: ADMIN_ID } });
  await prisma.$disconnect();
});

it('drops a detached organization repository from the tracked set', async () => {
  const before = await status.getCollectionRepositories();

  await service.updateMine(githubId, programId, input);

  const after = await status.getCollectionRepositories();
  expect(after).toHaveLength(before.length - 1);
});

it('reads each tracked organization repository success time from the repo ledger', async () => {
  const succeededAt = new Date('2099-02-01T00:00:00.000Z');
  const tracked = await prisma.repo.update({
    where: { githubRepoId: oldGithubId },
    data: { lastSuccessAt: succeededAt },
  });

  const repositories = await status.getCollectionRepositories();

  expect(
    repositories
      .filter((repository) => repository.repositoryName === tracked.ownerName)
      .map((repository) => repository.lastSuccessAt),
  ).toContainEqual(succeededAt);
  expect((await statusService.getStatus()).collection.lastSuccessAt).toEqual(
    succeededAt,
  );
});

it('counts the new external link instead of the detached external one', async () => {
  await prisma.repo.update({
    where: { githubRepoId: oldGithubId },
    data: { source: 'EXTERNAL_PUBLIC' },
  });
  const before = await status.getExternalCollectionStatus();

  await service.updateMine(githubId, programId, input);

  const after = await status.getExternalCollectionStatus();
  expect(after.trackedRepositoryCount).toBe(before.trackedRepositoryCount);
});

it('drops an external repository from the tracked count once deletion clears its links', async () => {
  await prisma.repo.update({
    where: { githubRepoId: oldGithubId },
    data: {
      source: 'EXTERNAL_PUBLIC',
      presence: 'PRESENT',
      visibility: 'PUBLIC',
    },
  });
  const linked = await status.getExternalCollectionStatus();

  await unlinkRepo(prisma, oldGithubId);

  const cleared = await status.getExternalCollectionStatus();
  expect(cleared.trackedRepositoryCount).toBe(
    linked.trackedRepositoryCount - 1,
  );
});

it('reports the newest repo ledger success of tracked external repositories and drops it once the link clears', async () => {
  const before = await status.getExternalCollectionStatus();
  const succeededAt = new Date(
    Math.max(
      before.lastSuccessAt?.getTime() ?? 0,
      Date.parse('2099-01-01T00:00:00.000Z'),
    ) + 60_000,
  );
  await prisma.repo.update({
    where: { githubRepoId: oldGithubId },
    data: {
      source: 'EXTERNAL_PUBLIC',
      presence: 'PRESENT',
      visibility: 'PUBLIC',
      lastSuccessAt: succeededAt,
    },
  });

  const linked = await status.getExternalCollectionStatus();
  expect(linked.lastSuccessAt).toEqual(succeededAt);

  await unlinkRepo(prisma, oldGithubId);

  const cleared = await status.getExternalCollectionStatus();
  expect(cleared.lastSuccessAt).not.toEqual(succeededAt);
});

it('counts live provisioning jobs by status and lists final failures with team and program names', async () => {
  const before = await status.getProvisioningStatus();
  await prisma.repositoryProvisionJob.create({
    data: {
      teamId,
      status: 'FAILED_FINAL',
      lastErrorCode: 'REPOSITORY_PROVISION_INTERNAL',
    },
  });

  const after = await status.getProvisioningStatus();

  expect(after.failedFinal).toBe(before.failedFinal + 1);
  expect(after.pending).toBe(before.pending);
  expect(after.failedTeams).toContainEqual({
    teamId,
    teamName: 'Synthetic team',
    programName: 'Synthetic relink program',
    lastErrorCode: 'REPOSITORY_PROVISION_INTERNAL',
    updatedAt: expect.any(Date) as unknown,
  });

  await prisma.program.update({
    where: { id: programId },
    data: { lifecycle: 'DELETED' },
  });
  const deleted = await status.getProvisioningStatus();
  expect(deleted.failedFinal).toBe(before.failedFinal);
  expect(deleted.failedTeams.map((team) => team.teamId)).not.toContain(teamId);
});

it('counts email sends and failures in the window and reports the latest successful send', async () => {
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * HOUR_MS);
  const before = await status.getMailStatus(since);
  const recentSend = new Date(now.getTime() - HOUR_MS);
  await prisma.notification.createMany({
    data: [
      { status: 'SENT', channel: 'EMAIL', sentAt: recentSend },
      {
        status: 'SENT',
        channel: 'EMAIL',
        sentAt: new Date(now.getTime() - 8 * 24 * HOUR_MS),
      },
      { status: 'FAILED', channel: 'EMAIL', sentAt: null },
      { status: 'SENT', channel: 'IN_APP', sentAt: recentSend },
    ].map((row) => ({
      ...row,
      userId: ADMIN_ID,
      type: MAIL_TYPE,
      payload: {},
    })),
  });

  const after = await status.getMailStatus(since);

  expect(after.sent7d).toBe(before.sent7d + 1);
  expect(after.failed7d).toBe(before.failed7d + 1);
  expect(after.lastSentAt?.getTime()).toBeGreaterThanOrEqual(
    recentSend.getTime(),
  );
});

it('keeps the full failure count while listing the latest 100 failed teams', async () => {
  const before = await status.getProvisioningStatus();
  const { leaderId } = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    select: { leaderId: true },
  });
  const ids = Array.from(
    { length: 101 },
    (_, index) => `${teamId}-failed-${index}`,
  );
  try {
    await prisma.team.createMany({
      data: ids.map((id) => ({
        id,
        programId,
        leaderId,
        applicantId: leaderId,
        name: id,
        answers: {},
        applicationTemplateVersion: 1,
      })),
    });
    await prisma.repositoryProvisionJob.createMany({
      data: ids.map((id, index) => ({
        teamId: id,
        status: 'FAILED_FINAL' as const,
        updatedAt: new Date(Date.UTC(2099, 0, 1, 0, index)),
      })),
    });

    const result = await status.getProvisioningStatus();

    expect(result.failedFinal).toBe(before.failedFinal + 101);
    expect(result.failedTeams.map((team) => team.teamId)).toEqual(
      ids.slice(1).reverse(),
    );
  } finally {
    await prisma.repositoryProvisionJob.deleteMany({
      where: { teamId: { in: ids } },
    });
    await prisma.team.deleteMany({ where: { id: { in: ids } } });
  }
});

it('preserves removal peaks and admin change counts across history pages', async () => {
  const weekdayNoon = koreaNoonWithinLastWeek(new Date(), false);
  const subjectId = `${SELF_SUBJECT_ID}-paged`;
  await prisma.user.create({
    data: {
      id: subjectId,
      githubId: 9_517_000_000_004n,
      nickname: subjectId,
    },
  });
  await seedTeamRemovals(501, weekdayNoon, 0);
  await prisma.programHistory.createMany({
    data: Array.from({ length: 501 }, () => ({
      programId: HISTORY_PROGRAM_ID,
      actorId: ADMIN_ID,
      event: 'DELETED' as const,
      occurredAt: weekdayNoon,
      source: 'APPLICATION' as const,
      data: { schemaVersion: 1, metadata: {} },
    })),
  });
  await prisma.adminHistory.createMany({
    data: Array.from({ length: 501 }, () => ({
      userId: subjectId,
      actorId: subjectId,
      event: 'GRANTED' as const,
      occurredAt: weekdayNoon,
      source: 'APPLICATION' as const,
      data: {},
    })),
  });

  const { anomalies } = await statusService.getStatus();

  expect(anomalies.filter(({ rule }) => rule === 'BULK_REMOVAL')).toEqual([
    {
      rule: 'BULK_REMOVAL',
      severity: 'HIGH',
      count: 1002,
      target: { kind: 'USER', id: ADMIN_ID, login: null },
    },
  ]);
  expect(
    anomalies.filter(
      ({ rule, target }) =>
        rule === 'SELF_ADMIN_CHANGE' && target?.id === subjectId,
    ),
  ).toEqual([
    {
      rule: 'SELF_ADMIN_CHANGE',
      severity: 'HIGH',
      count: 501,
      target: { kind: 'USER', id: subjectId, login: subjectId },
    },
  ]);
});

it('reads only actor-attributed rejections and deletions inside the window', async () => {
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * HOUR_MS);
  const recent = new Date(now.getTime() - HOUR_MS);
  await prisma.teamHistory.createMany({
    data: [
      { event: 'REJECTED' as const, actorId: ADMIN_ID, occurredAt: recent },
      { event: 'DELETED' as const, actorId: ADMIN_ID, occurredAt: recent },
      { event: 'APPROVED' as const, actorId: ADMIN_ID, occurredAt: recent },
      { event: 'REJECTED' as const, actorId: null, occurredAt: recent },
      {
        event: 'REJECTED' as const,
        actorId: ADMIN_ID,
        occurredAt: new Date(now.getTime() - 8 * 24 * HOUR_MS),
      },
    ].map((row) => ({
      ...row,
      teamId: HISTORY_TEAM_ID,
      programId: HISTORY_PROGRAM_ID,
      source: 'APPLICATION' as const,
      data: teamHistoryData(row.event),
    })),
  });
  await prisma.programHistory.create({
    data: {
      programId: HISTORY_PROGRAM_ID,
      actorId: ADMIN_ID,
      event: 'DELETED',
      occurredAt: recent,
      source: 'APPLICATION',
      data: { schemaVersion: 1, metadata: {} },
    },
  });

  const events = await status.findBulkRemovalEvents(since);

  expect(events.filter((event) => event.actorId === ADMIN_ID)).toEqual([
    { actorId: ADMIN_ID, occurredAt: recent },
    { actorId: ADMIN_ID, occurredAt: recent },
    { actorId: ADMIN_ID, occurredAt: recent },
  ]);
});

it('raises BULK_REMOVAL for ten seeded rejections within ten minutes and not for nine', async () => {
  const start = new Date(Date.now() - 2 * HOUR_MS);
  await seedTeamRemovals(9, start, 60_000);
  expect(
    (await anomaliesFor(ADMIN_ID)).filter(
      ({ rule }) => rule === 'BULK_REMOVAL',
    ),
  ).toEqual([]);

  await seedTeamRemovals(1, new Date(start.getTime() + 9 * 60_000), 0);

  expect(
    (await anomaliesFor(ADMIN_ID)).filter(
      ({ rule }) => rule === 'BULK_REMOVAL',
    ),
  ).toEqual([
    {
      rule: 'BULK_REMOVAL',
      severity: 'HIGH',
      count: 10,
      target: { kind: 'USER', id: ADMIN_ID, login: null },
    },
  ]);
});

it('raises SELF_ADMIN_CHANGE only when the seeded admin change targets its own actor', async () => {
  const weekdayNoon = koreaNoonWithinLastWeek(new Date(), false);
  await seedAdminChange(SELF_SUBJECT_ID, weekdayNoon, null);
  expect(await anomaliesFor(SELF_SUBJECT_ID)).toEqual([]);

  await seedAdminChange(SELF_SUBJECT_ID, weekdayNoon, SELF_SUBJECT_ID);

  expect(await anomaliesFor(SELF_SUBJECT_ID)).toEqual([
    {
      rule: 'SELF_ADMIN_CHANGE',
      severity: 'HIGH',
      count: 1,
      target: { kind: 'USER', id: SELF_SUBJECT_ID, login: SELF_SUBJECT_ID },
    },
  ]);
});

it('raises OFF_HOURS_ADMIN_CHANGE for a seeded weekend change and ignores legacy imports', async () => {
  const weekendNoon = koreaNoonWithinLastWeek(new Date(), true);
  await prisma.adminHistory.create({
    data: {
      userId: OFF_HOURS_SUBJECT_ID,
      event: 'LEGACY_IMPORT',
      occurredAt: weekendNoon,
      source: 'MIGRATION',
      data: {},
    },
  });
  expect(await anomaliesFor(OFF_HOURS_SUBJECT_ID)).toEqual([]);

  await seedAdminChange(OFF_HOURS_SUBJECT_ID, weekendNoon, null);

  expect(await anomaliesFor(OFF_HOURS_SUBJECT_ID)).toEqual([
    {
      rule: 'OFF_HOURS_ADMIN_CHANGE',
      severity: 'MEDIUM',
      count: 1,
      target: {
        kind: 'USER',
        id: OFF_HOURS_SUBJECT_ID,
        login: OFF_HOURS_SUBJECT_ID,
      },
    },
  ]);
});
