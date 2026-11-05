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
import { prisma, service, applications, audit, resolver, githubId, programId, teamId, oldId, targetId, targetGithubId, input } from './student-repository-url.integration.fixture';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { TeamApplicationService } from './team-application.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { ApplicationAnswersService } from './team-application.service';

const parseProvisionPayload = (payload: unknown) =>
  new RepositoryProvisionEventService().parseRepositoryProvisionEvent(payload);

const auditLogMetadataService = new AuditLogMetadataService();
const applicationsService = new TeamApplicationService(applications, new RepositoryUrlService(), new ApplicationAnswersService(), new RepositoryProvisionEventService());

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
    await prisma.contribution.findMany({ where: { repositoryId: oldId } }),
  ).toEqual([]);
  expect(await prisma.githubRepository.count({ where: { teamId } })).toBe(1);
  expect(
    await prisma.githubRepository.count({
    where: { id: { in: [oldId, targetId] }, teamId: null }
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
  expect(
    await prisma.team.findUnique({ where: { id: teamId } }),
  ).toMatchObject({
    repositoryConnectionMode: RepositoryConnectionMode.OWN,
    repositoryUrl: input.repositoryUrl,
  });
  const entries = await prisma.auditLog.findMany({
    where: { targetId: teamId },
  });
  expect(entries).toMatchObject([
    {
      action: 'APPLICATION_REPOSITORY_URL_CHANGED',
      metadata: {
        schemaVersion: 2,
        before: { repositoryId: oldId },
        after: { repositoryId: targetId, repositoryUrl: input.repositoryUrl },
        deletedCounts: { repositories: 1, contributions: 1 },
      },
    },
  ]);
  expect(entries[0]?.metadata).not.toHaveProperty('reason');
});

it('rejects a repository relink after the program is deleted and keeps its current binding', async () => {
  const before = await prisma.githubRepository.findUniqueOrThrow({
    where: { id: oldId }
});
  const targetBefore = await prisma.githubRepository.findUniqueOrThrow({
    where: { id: targetId }
});
  await prisma.program.update({
    where: { id: programId },
    data: { lifecycle: 'DELETED' }
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
it('rolls back binding and queue changes when the audit write fails', async () => {
  jest
    .spyOn(audit, 'record')
    .mockRejectedValue(new Error('Synthetic audit outage'));
  await expect(service.updateMine(githubId, programId, input)).rejects.toThrow(
    'Synthetic audit outage',
  );
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ teamId });
  expect(
    await prisma.contribution.findMany({ where: { repositoryId: oldId } }),
  ).toEqual([expect.objectContaining({ commitCount: 7 })]);
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({ teamId: null, presence: 'ABSENT', failureCount: 4 });
  expect(
    await prisma.team.findUnique({ where: { id: teamId } }),
  ).toMatchObject({
    repositoryConnectionMode: RepositoryConnectionMode.NEW,
    repositoryUrl: null,
  });
});
it('rejects a processing provision job without detaching the current repository', async () => {
  await prisma.repositoryProvisionJob.create({
    data: {
        teamId,
        repositoryId: oldId,
        status: RepositoryProvisionJobStatus.PROCESSING
    }
});
  await expect(
    service.updateMine(githubId, programId, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_030' } });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ teamId });
});
it('serializes duplicate edits into one audit entry', async () => {
  await Promise.all([
    service.updateMine(githubId, programId, input),
    service.updateMine(githubId, programId, input),
  ]);
  expect(
    await prisma.auditLog.count({ where: { targetId: teamId } }),
  ).toBe(1);
  expect(await prisma.githubRepository.count({ where: { teamId } })).toBe(1);
});

it('같은 URL을 다시 등록해도 레포와 수집 기록 및 감사 이력을 유지한다', async () => {
  await service.updateMine(githubId, programId, input);
  await prisma.contribution.create({
    data: {
      repositoryId: targetId,
      githubId,
      date: new Date('2026-08-02T00:00:00Z'),
      commitCount: 3,
    },
  });

  await service.updateMine(githubId, programId, input);

  expect(await prisma.githubRepository.count({ where: { teamId } })).toBe(1);
  expect(
    await prisma.contribution.findMany({ where: { repositoryId: targetId } }),
  ).toEqual([expect.objectContaining({ commitCount: 3 })]);
  expect(
    await prisma.auditLog.count({ where: { targetId: teamId } }),
  ).toBe(1);
});

it('같은 GitHub 레포의 이름이 바뀌어도 행과 수집 기록을 유지한다', async () => {
  await service.updateMine(githubId, programId, input);
  await prisma.contribution.create({
    data: {
      repositoryId: targetId,
      githubId,
      date: new Date('2026-08-02T00:00:00Z'),
      commitCount: 3,
    },
  });
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
    await prisma.contribution.findMany({ where: { repositoryId: targetId } }),
  ).toEqual([expect.objectContaining({ commitCount: 3 })]);
});
it('projects a successful relink without an original provision outbox', async () => {
  await service.updateMine(githubId, programId, input);
  expect(
    await prisma.repositoryProvisionJob.findUnique({
    where: { teamId }
}),
  ).toMatchObject({
    repositoryId: targetId,
    status: RepositoryProvisionJobStatus.SUCCEEDED,
  });
  expect(
    (await applicationsService.getForStaff(teamId)).application,
  ).toMatchObject({
    repositoryConnectionMode: RepositoryConnectionMode.OWN,
    repositoryUrl: input.repositoryUrl,
    repositoryProvisioning: { jobStatus: 'SUCCEEDED' },
  });
});
it('takes a manual link out of the membership access sync on a provisioning-on program', async () => {
  await prisma.program.update({
    where: { id: programId },
    data: { repositoryProvisioningEnabled: true }
});
  expect(
    await prisma.team.count({
    where: new PlatformRepository().repositoryAccessSyncTargetWhere(teamId)
}),
  ).toBe(1);

  await service.updateMine(githubId, programId, input);

  expect(
    await prisma.team.count({
    where: new PlatformRepository().repositoryAccessSyncTargetWhere(teamId)
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

  expect(
    await prisma.team.findUnique({ where: { id: teamId } }),
  ).toMatchObject({
    repositoryConnectionMode: RepositoryConnectionMode.OWN,
    repositoryUrl: 'https://github.com/synthetic-org/target',
  });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({
    teamId,
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
    where: { teamId }
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
    data: { endAt: new Date('2026-02-01') }
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

it('serializes different targets into a continuous audit chain', async () => {
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
  const rows = await prisma.auditLog.findMany({
    where: { targetId: teamId },
  });
  const history = rows.map((row) =>
    auditLogMetadataService.parseApplicationRepositoryUrlAuditMetadata(
      row.metadata,
    ),
  );
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
        description: 'Synthetic'
    }
});
  await prisma.githubRepository.update({
    where: { id: targetId },
    data: {}
});
  await expect(
    service.updateMine(githubId, programId, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_029' } });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ teamId });
  expect(
    await prisma.auditLog.count({ where: { targetId: teamId } }),
  ).toBe(0);
});

it('rejects another team history that lands on the target after it was read', async () => {
  const otherProgramId = `${programId}-race`;
  const otherTeamId = `${teamId}-race`;
  const { id: leaderId } = await prisma.user.findUniqueOrThrow({
    where: { githubId }
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
        description: 'Synthetic'
    }
});
  await prisma.team.create({
    data: {
        id: otherTeamId,
        programId: otherProgramId,
        name: 'Synthetic race team',
        leaderId,
        applicantId: leaderId,
        answers: { title: 'Synthetic race team' },
        applicationTemplateVersion: 1
    }
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
    data: { teamId: otherTeamId }
});
  });
  await locked;

  const relink = service.updateMine(githubId, programId, input).then(
    () => 'linked',
    (error: unknown) => error,
  );
  await waitForGithubRepositoryUpdateWaiter();
  release();
  await otherTeam;

  expect(await relink).toMatchObject({ errorCode: { code: 'APP_029' } });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({
    teamId: null,
    programId: otherProgramId,
  });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ teamId });
  expect(
    await prisma.auditLog.count({ where: { targetId: teamId } }),
  ).toBe(0);
});

async function waitForGithubRepositoryUpdateWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await prisma.$queryRaw<readonly { waiting: bigint }[]>`
      SELECT COUNT(*) AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE '%UPDATE%"GithubRepository"%'
    `;
    if ((rows[0]?.waiting ?? 0n) > 0n) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Expected the relink to wait on the current repository row.');
}

it('lets the original applicant read but rejects writes after leadership changes', async () => {
  const successor = await prisma.user.create({
    data: { githubId: targetGithubId + 5n, nickname: 'synthetic-successor' }
});
  await prisma.teamMember.create({
    data: { teamId, programId, userId: successor.id }
});
  await prisma.team.update({
    where: { id: teamId },
    data: { leaderId: successor.id }
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
    await prisma.auditLog.count({ where: { targetId: teamId } }),
  ).toBe(0);
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ teamId });
});
