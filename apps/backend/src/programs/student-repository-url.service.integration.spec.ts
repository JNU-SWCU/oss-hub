import { RepositoryProvisionEventService } from '../github/repository-provision-event.service';
import {
  RepositoryConnectionMode,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  RepositorySource,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PlatformRepository } from '../platform/platform.repository';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import { REPOSITORY_PROVISION_EVENT_TYPE } from '../github/repository-provision-event.config';
import {
  prisma,
  service,
  applications,
  resolver,
  githubId,
  programId,
  teamId,
  oldId,
  targetId,
  targetGithubId,
  input,
} from './student-repository-url.integration.fixture';
import {
  repositoryContributionTotals,
  seedDailyContributions,
} from '../../test/ledger-contribution.fixture';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { TeamApplicationService } from './team-application.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { ApplicationAnswersService } from './team-application.service';
import { StudentRepositoryUrlService } from './team-application.service';
import { TeamMembershipService } from './team-membership.service';
import {
  ProgramTeamDeletionRepository,
  TeamDeletionScopeRepository,
  TeamRepository,
} from './team.repository';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import { TeamHistoryRepository } from './team-history.repository';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { RepositoryPublishService } from '../github/repository-publish.service';
import { MilestoneCompletionService } from './submissions.service';

const parseProvisionPayload = (payload: unknown) =>
  new RepositoryProvisionEventService().parseRepositoryProvisionEvent(payload);

const historyMetadataService = new HistoryMetadataService();
const applicationsService = new TeamApplicationService(
  applications,
  new RepositoryUrlService(),
  new ApplicationAnswersService(),
  new RepositoryProvisionEventService(),
);
const teamsService = new TeamMembershipService(
  new TeamRepository(
    prisma,
    new ProgramTeamRepositoryEvidenceRepository(prisma),
    new PlatformRepository(),
    new TeamHistoryRepository(),
  ),
  new ProgramTeamDeletionRepository(
    new TeamHistoryRepository(),
    prisma,
    new TeamDeletionScopeRepository(),
    new PrismaSerializationRetryRepository(),
  ),
  historyMetadataService,
  new RepositoryPublishService(),
  new RepositoryUrlService(),
  new MilestoneCompletionService(),
  new StudentRepositoryUrlService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  ),
);

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "GithubRepository_teamId_task7_test_key"
    ON "GithubRepository" ("teamId")
    WHERE "teamId" LIKE 'synthetic-url-relink-%'
  `);
});
afterAll(async () => {
  await prisma.$executeRawUnsafe(
    `DROP INDEX IF EXISTS "GithubRepository_teamId_task7_test_key"`,
  );
  await prisma.$disconnect();
});

it('교체는 옛 레포와 수집 기록을 지우고 새 레포 하나와 삭제 이력을 남긴다', async () => {
  await service.updateMine(githubId, programId, input);

  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toBeNull();
  expect(
    (await repositoryContributionTotals(prisma, [oldId])).commitCount,
  ).toBe(0);
  expect(await prisma.githubRepository.count({ where: { teamId } })).toBe(1);
  expect(
    await prisma.githubRepository.count({
      where: { id: { in: [oldId, targetId] }, teamId: null },
    }),
  ).toBe(0);
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({
    teamId,
    presence: 'PRESENT',
    failureCount: 0,
    archived: false,
    defaultBranch: 'main',
    source: RepositorySource.EXTERNAL_PUBLIC,
  });
  expect(await prisma.team.findUnique({ where: { id: teamId } })).toMatchObject(
    {
      repositoryConnectionMode: RepositoryConnectionMode.OWN,
    },
  );
  const entries = await prisma.teamHistory.findMany({
    where: { teamId, event: 'REPOSITORY_URL_CHANGED' },
  });
  expect(entries).toMatchObject([
    {
      event: 'REPOSITORY_URL_CHANGED',
      data: {
        metadata: {
          schemaVersion: 2,
          before: { repositoryId: oldId },
          after: { repositoryId: targetId, repositoryUrl: input.repositoryUrl },
          deletedCounts: { repositories: 1, contributions: 1 },
        },
      },
    },
  ]);
  expect(entries[0]?.data).not.toHaveProperty('metadata.reason');
});

it('rejects a repository relink after the program is deleted and keeps its current binding', async () => {
  const before = await prisma.githubRepository.findUniqueOrThrow({
    where: { id: oldId },
  });
  const targetBefore = await prisma.githubRepository.findUniqueOrThrow({
    where: { id: targetId },
  });
  await prisma.program.update({
    where: { id: programId },
    data: { lifecycle: 'DELETED' },
  });

  await expect(
    service.updateMine(githubId, programId, input),
  ).rejects.toThrow();

  expect(
    await prisma.githubRepository.findUniqueOrThrow({ where: { id: oldId } }),
  ).toEqual(before);
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toEqual(targetBefore);
});
it('rolls back binding and queue changes when the team history write fails', async () => {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "TeamHistory" ADD CONSTRAINT "todo9_url_history_failure" CHECK (event <> 'REPOSITORY_URL_CHANGED') NOT VALID`,
  );
  try {
    await expect(
      service.updateMine(githubId, programId, input),
    ).rejects.toThrow('todo9_url_history_failure');
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "TeamHistory" DROP CONSTRAINT "todo9_url_history_failure"',
    );
  }
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ teamId });
  expect(
    (await repositoryContributionTotals(prisma, [oldId])).commitCount,
  ).toBe(7);
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({ teamId: null, presence: 'ABSENT', failureCount: 4 });
  expect(await prisma.team.findUnique({ where: { id: teamId } })).toMatchObject(
    {
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
    },
  );
});
it('rejects a processing provision job without detaching the current repository', async () => {
  await prisma.repositoryProvisionJob.create({
    data: {
      teamId,
      repositoryId: oldId,
      status: RepositoryProvisionJobStatus.PROCESSING,
    },
  });
  await expect(
    service.updateMine(githubId, programId, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_030' } });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ teamId });
});
it('serializes duplicate edits into one team history entry', async () => {
  await Promise.all([
    service.updateMine(githubId, programId, input),
    service.updateMine(githubId, programId, input),
  ]);
  expect(
    await prisma.teamHistory.count({
      where: { teamId, event: 'REPOSITORY_URL_CHANGED' },
    }),
  ).toBe(1);
  expect(await prisma.githubRepository.count({ where: { teamId } })).toBe(1);
});

it('같은 URL을 다시 등록해도 레포와 수집 기록 및 감사 이력을 유지한다', async () => {
  await service.updateMine(githubId, programId, input);
  await seedDailyContributions(prisma, targetGithubId, [
    { githubId, date: '2026-08-02', commitCount: 3 },
  ]);

  await service.updateMine(githubId, programId, input);

  expect(await prisma.githubRepository.count({ where: { teamId } })).toBe(1);
  expect(
    (await repositoryContributionTotals(prisma, [targetId])).commitCount,
  ).toBe(3);
  expect(
    await prisma.teamHistory.count({
      where: { teamId, event: 'REPOSITORY_URL_CHANGED' },
    }),
  ).toBe(1);
});

it('같은 GitHub 레포의 이름이 바뀌어도 행과 수집 기록을 유지한다', async () => {
  await service.updateMine(githubId, programId, input);
  await seedDailyContributions(prisma, targetGithubId, [
    { githubId, date: '2026-08-02', commitCount: 3 },
  ]);
  resolver.resolve.mockResolvedValue({
    kind: 'EXTERNAL',
    repository: {
      githubRepositoryId: targetGithubId,
      name: 'renamed',
      nameWithOwner: 'synthetic/renamed',
      url: 'https://github.com/synthetic/renamed',
      visibility: 'PUBLIC',
      description: null,
      defaultBranch: 'main',
      archived: false,
    },
  });
  await service.updateMine(githubId, programId, {
    repositoryUrl: 'https://github.com/synthetic/renamed',
  });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({ teamId, nameWithOwner: 'synthetic/renamed' });
  expect(await prisma.githubRepository.count({ where: { teamId } })).toBe(1);
  expect(
    (await repositoryContributionTotals(prisma, [targetId])).commitCount,
  ).toBe(3);
});
it('projects a successful relink without an original provision outbox', async () => {
  await service.updateMine(githubId, programId, input);
  expect(
    await prisma.repositoryProvisionJob.findUnique({
      where: { teamId },
    }),
  ).toMatchObject({
    repositoryId: targetId,
    status: RepositoryProvisionJobStatus.SUCCEEDED,
  });
  expect(
    (await applicationsService.getForStaff(teamId)).application,
  ).toMatchObject({
    repositoryConnectionMode: RepositoryConnectionMode.OWN,
    repository: { url: input.repositoryUrl },
    repositoryProvisioning: { jobStatus: 'SUCCEEDED' },
  });
});
it('keeps a relinked repository SUCCEEDED after GitHub renames it', async () => {
  await service.updateMine(githubId, programId, input);
  await prisma.githubRepository.update({
    where: { id: targetId },
    data: { nameWithOwner: 'synthetic/target-renamed' },
  });

  expect(
    await prisma.repositoryProvisionJob.findUnique({ where: { teamId } }),
  ).toMatchObject({
    repositoryId: targetId,
    status: RepositoryProvisionJobStatus.SUCCEEDED,
  });
  expect(
    await prisma.outboxEvent.count({
      where: { aggregateId: teamId, type: REPOSITORY_PROVISION_EVENT_TYPE },
    }),
  ).toBe(0);
  expect(
    (await applicationsService.getForStaff(teamId)).application,
  ).toMatchObject({
    repositoryConnectionMode: RepositoryConnectionMode.OWN,
    repository: { url: 'https://github.com/synthetic/target-renamed' },
    repositoryProvisioning: { jobStatus: 'SUCCEEDED' },
  });
  expect(
    (await teamsService.getForStaff(programId, teamId)).application,
  ).toMatchObject({
    repositoryConnectionMode: RepositoryConnectionMode.OWN,
    repositoryProvisioning: { jobStatus: 'SUCCEEDED' },
  });
});
it('takes a manual link out of the membership access sync on a provisioning-on program', async () => {
  await prisma.program.update({
    where: { id: programId },
    data: { repositoryProvisioningEnabled: true },
  });
  expect(
    await prisma.team.count({
      where: new PlatformRepository().repositoryAccessSyncTargetWhere(teamId),
    }),
  ).toBe(1);

  await service.updateMine(githubId, programId, input);

  expect(
    await prisma.team.count({
      where: new PlatformRepository().repositoryAccessSyncTargetWhere(teamId),
    }),
  ).toBe(0);
});
it('links a managed organization repository without re-arming provisioning', async () => {
  const pending = await prisma.$transaction(async (transaction) => {
    const now = new Date();
    const event = await transaction.outboxEvent.create({
      data: {
        type: REPOSITORY_PROVISION_EVENT_TYPE,
        aggregateType: 'Team',
        aggregateId: teamId,
        idempotencyKey: `repository-provision:${teamId}`,
        payload: {
          teamId,
          programId,
          requestedAt: now.toISOString(),
          collaboratorGithubLogins: ['synthetic-relink-user'],
          repositoryConnectionMode: 'NEW',
          repositoryUrl: null,
        },
        availableAt: now,
      },
    });
    await new RepositoryProvisionGenerationRepository().transferProvisionGeneration(
      transaction,
      { teamId, newEventId: event.id, now },
      parseProvisionPayload,
    );
    return event;
  });
  resolver.resolve.mockResolvedValue({
    kind: 'ORGANIZATION',
    repository: {
      githubRepositoryId: targetGithubId,
      name: 'target',
      nameWithOwner: 'synthetic-org/target',
      url: 'https://github.com/synthetic-org/target',
      visibility: 'PRIVATE',
      description: null,
    },
  });

  await service.updateMine(githubId, programId, {
    ...input,
    repositoryUrl: 'https://github.com/synthetic-org/target',
  });

  expect(await prisma.team.findUnique({ where: { id: teamId } })).toMatchObject(
    {
      repositoryConnectionMode: RepositoryConnectionMode.OWN,
    },
  );
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({
    teamId,
    nameWithOwner: 'synthetic-org/target',
    source: RepositorySource.ORG_PROVISIONED,
  });
  expect(
    await prisma.outboxEvent.findMany({
      where: { aggregateId: teamId },
      select: { id: true },
    }),
  ).toEqual([{ id: pending.id }]);
  expect(
    await prisma.repositoryInvitation.count({
      where: { repositoryId: targetId },
    }),
  ).toBe(0);

  expect(
    await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { teamId },
    }),
  ).toMatchObject({
    repositoryId: targetId,
    status: RepositoryProvisionJobStatus.SUCCEEDED,
    currentEventId: null,
  });
  expect(
    await prisma.repositoryIssuanceHistory.findUniqueOrThrow({
      where: { requestId: pending.id },
    }),
  ).toMatchObject({ outcome: RepositoryIssuanceOutcome.SUPERSEDED });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toBeNull();
});
it('checks the program end after acquiring the transaction lock', async () => {
  jest.spyOn(resolver, 'resolve').mockImplementationOnce(async () => {
    await prisma.program.update({
      where: { id: programId },
      data: { endAt: new Date('2026-02-01') },
    });
    return {
      kind: 'EXTERNAL',
      repository: {
        githubRepositoryId: targetGithubId,
        name: 'target',
        nameWithOwner: 'synthetic/target',
        url: input.repositoryUrl,
        visibility: 'PUBLIC',
        description: null,
        defaultBranch: 'main',
        archived: false,
      },
    };
  });
  await expect(
    service.updateMine(githubId, programId, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_028' } });
});

it('serializes different targets into a continuous team history chain', async () => {
  resolver.resolve.mockImplementation((url: string) =>
    Promise.resolve({
      kind: 'EXTERNAL',
      repository: {
        githubRepositoryId: url.endsWith('/other')
          ? targetGithubId + 2n
          : targetGithubId,
        nameWithOwner: url.endsWith('/other')
          ? 'synthetic/other'
          : 'synthetic/target',
        name: 'target',
        url,
        visibility: 'PUBLIC',
        description: null,
        defaultBranch: 'main',
        archived: false,
      },
    }),
  );
  await Promise.all([
    service.updateMine(githubId, programId, input),
    service.updateMine(githubId, programId, {
      ...input,
      repositoryUrl: 'https://github.com/synthetic/other',
    }),
  ]);
  const rows = await prisma.teamHistory.findMany({
    where: { teamId, event: 'REPOSITORY_URL_CHANGED' },
  });
  const history = rows.map((row) => {
    const data = row.data;
    if (data === null || typeof data !== 'object' || Array.isArray(data))
      throw new Error('Expected team history data');
    return historyMetadataService.parseApplicationRepositoryUrlAuditMetadata(
      data.metadata,
    );
  });
  expect(history).toHaveLength(2);
  const first = history.find((entry) => entry?.before.repositoryId === oldId);
  const second = history.find(
    (entry) => entry?.before.repositoryId === first?.after.repositoryId,
  );
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  expect(
    await prisma.githubRepository.findUnique({ where: { teamId } }),
  ).toMatchObject({ id: second?.after.repositoryId });
});

it('rejects a repository carrying another program history without detaching the current binding', async () => {
  const otherProgramId = `${programId}-foreign`;
  await prisma.program.create({
    data: {
      startAt: new Date('2026-01-01'),
      endAt: new Date(new Date('2026-01-31').getTime() + 365 * 86400000),
      id: otherProgramId,
      name: 'Synthetic foreign program',
      organizer: 'Synthetic',
      category: 'BASIC',
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01'),
      applicationEndAt: new Date('2026-01-31'),
      description: 'Synthetic',
    },
  });
  const leader = await prisma.user.findUniqueOrThrow({ where: { githubId } });
  const otherTeam = await prisma.team.create({
    data: {
      programId: otherProgramId,
      name: 'Foreign team',
      leaderId: leader.id,
      applicantId: leader.id,
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
  await prisma.githubRepository.update({
    where: { id: targetId },
    data: { teamId: otherTeam.id },
  });
  await expect(
    service.updateMine(githubId, programId, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_029' } });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ teamId });
  expect(
    await prisma.teamHistory.count({
      where: { teamId, event: 'REPOSITORY_URL_CHANGED' },
    }),
  ).toBe(0);
});

it('rejects another team history that lands on the target after it was read', async () => {
  const otherProgramId = `${programId}-race`;
  const otherTeamId = `${teamId}-race`;
  const { id: leaderId } = await prisma.user.findUniqueOrThrow({
    where: { githubId },
  });
  await prisma.program.create({
    data: {
      startAt: new Date('2026-01-01'),
      endAt: new Date(new Date('2026-01-31').getTime() + 365 * 86400000),
      id: otherProgramId,
      name: 'Synthetic race program',
      organizer: 'Synthetic',
      category: 'BASIC',
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01'),
      applicationEndAt: new Date('2026-01-31'),
      description: 'Synthetic',
    },
  });
  await prisma.team.create({
    data: {
      id: otherTeamId,
      programId: otherProgramId,
      name: 'Synthetic race team',
      leaderId,
      applicantId: leaderId,
      answers: { title: 'Synthetic race team' },
      applicationTemplateVersion: 1,
    },
  });
  let reportLocked!: () => void;
  let release!: () => void;
  const locked = new Promise<void>((resolve) => {
    reportLocked = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const otherTeam = prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "GithubRepository" WHERE "id" = ${oldId} FOR UPDATE`;
    reportLocked();
    await released;
    await transaction.githubRepository.update({
      where: { id: targetId },
      data: { teamId: otherTeamId },
    });
  });
  await locked;

  const relink = service.updateMine(githubId, programId, input).then(
    () => 'linked',
    (error: unknown) => error,
  );
  try {
    await waitForGithubRepositoryUpdateWaiter();
  } finally {
    release();
    await otherTeam;
    await relink;
  }

  expect(await relink).toMatchObject({ errorCode: { code: 'APP_029' } });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({
    teamId: otherTeamId,
  });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ teamId });
  expect(
    await prisma.teamHistory.count({
      where: { teamId, event: 'REPOSITORY_URL_CHANGED' },
    }),
  ).toBe(0);
});

async function waitForGithubRepositoryUpdateWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await prisma.$queryRaw<readonly { waiting: bigint }[]>`
      SELECT COUNT(*) AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE '%SELECT%"GithubRepository"%FOR UPDATE%'
    `;
    if ((rows[0]?.waiting ?? 0n) > 0n) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    'Expected the relink to wait on the repository deletion lock.',
  );
}

it('lets the original applicant read but rejects writes after leadership changes', async () => {
  const successor = await prisma.user.create({
    data: { githubId: targetGithubId + 5n, nickname: 'synthetic-successor' },
  });
  await prisma.teamMember.create({
    data: { teamId, programId, userId: successor.id },
  });
  await prisma.team.update({
    where: { id: teamId },
    data: { leaderId: successor.id },
  });
  expect(await service.getMine(githubId, programId)).toEqual({
    repositoryUrl: 'https://github.com/synthetic/old',
    canEditRepositoryUrl: false,
  });
  resolver.resolve.mockClear();
  await expect(
    service.updateMine(githubId, programId, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_001' } });
  expect(resolver.resolve).not.toHaveBeenCalled();
  expect(
    await prisma.teamHistory.count({
      where: { teamId, event: 'REPOSITORY_URL_CHANGED' },
    }),
  ).toBe(0);
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ teamId });
});
