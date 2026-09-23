import {
  RepositoryConnectionMode,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  RepositorySource,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { parseApplicationRepositoryUrlAuditMetadata } from '../audit-log/application-repository-url-audit-metadata';
import {
  parseRepositoryProvisionEvent,
  REPOSITORY_PROVISION_EVENT_TYPE,
  repositoryAccessSyncTargetWhere,
} from '../github/repository-provision-event';
import { transferProvisionGeneration } from '../prisma/repository-provision-generation';
import {
  prisma,
  service,
  applications,
  audit,
  resolver,
  githubId,
  programId,
  applicationId,
  teamId,
  oldId,
  targetId,
  targetGithubId,
  input,
} from './student-repository-url.integration.fixture';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

it('relinks and enqueues the new identity while preserving historical contributions', async () => {
  // When
  await service.updateMine(githubId, programId, input);
  // Then
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ applicationId: null, programId, teamId });
  expect(
    await prisma.contribution.findMany({ where: { repositoryId: oldId } }),
  ).toEqual([expect.objectContaining({ commitCount: 7 })]);
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({
    applicationId,
    presence: 'PRESENT',
    failureCount: 0,
    archived: false,
    defaultBranch: 'main',
    source: RepositorySource.EXTERNAL_PUBLIC,
  });
  expect(
    await prisma.application.findUnique({ where: { id: applicationId } }),
  ).toMatchObject({
    repositoryConnectionMode: RepositoryConnectionMode.OWN,
    repositoryUrl: input.repositoryUrl,
  });
  const entries = await prisma.auditLog.findMany({
    where: { targetId: applicationId },
  });
  expect(entries).toMatchObject([
    {
      action: 'APPLICATION_REPOSITORY_URL_CHANGED',
      metadata: {
        schemaVersion: 2,
        before: { repositoryId: oldId },
        after: { repositoryId: targetId, repositoryUrl: input.repositoryUrl },
      },
    },
  ]);
  expect(entries[0]?.metadata).not.toHaveProperty('reason');
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
  ).toMatchObject({ applicationId });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({ applicationId: null, presence: 'ABSENT', failureCount: 4 });
  expect(
    await prisma.application.findUnique({ where: { id: applicationId } }),
  ).toMatchObject({
    repositoryConnectionMode: RepositoryConnectionMode.NEW,
    repositoryUrl: null,
  });
});
it('rejects a processing provision job without detaching the current repository', async () => {
  await prisma.repositoryProvisionJob.create({
    data: {
      applicationId,
      repositoryId: oldId,
      status: RepositoryProvisionJobStatus.PROCESSING,
    },
  });
  await expect(
    service.updateMine(githubId, programId, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_030' } });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ applicationId });
});
it('serializes duplicate edits into one audit entry', async () => {
  await Promise.all([
    service.updateMine(githubId, programId, input),
    service.updateMine(githubId, programId, input),
  ]);
  expect(
    await prisma.auditLog.count({ where: { targetId: applicationId } }),
  ).toBe(1);
});
it('projects a successful relink without an original provision outbox', async () => {
  await service.updateMine(githubId, programId, input);
  expect(
    await prisma.repositoryProvisionJob.findUnique({
      where: { applicationId },
    }),
  ).toMatchObject({
    repositoryId: targetId,
    status: RepositoryProvisionJobStatus.SUCCEEDED,
  });
  expect(
    await applications.findApplicationForStaff(applicationId),
  ).toMatchObject({
    repositoryConnectionMode: RepositoryConnectionMode.OWN,
    repositoryUrl: input.repositoryUrl,
    repositoryProvisioning: { jobStatus: 'SUCCEEDED' },
  });
});
it('takes a manual link out of the membership access sync on a provisioning-on program', async () => {
  // Given: 발급이 켜진 프로그램의 승인 신청은 팀원이 바뀌면 권한 동기화 대상이다.
  await prisma.program.update({
    where: { id: programId },
    data: { repositoryProvisioningEnabled: true },
  });
  expect(
    await prisma.application.count({
      where: repositoryAccessSyncTargetWhere(teamId),
    }),
  ).toBe(1);
  // When
  await service.updateMine(githubId, programId, input);
  // Then: 직접 연결은 초대하지 않으므로 끝난 job을 다시 깨울 이유가 없다.
  expect(
    await prisma.application.count({
      where: repositoryAccessSyncTargetWhere(teamId),
    }),
  ).toBe(0);
});
it('links a managed organization repository without re-arming provisioning', async () => {
  // Given: 승인 때 만든 발급 요청이 아직 끝나지 않았다.
  const pending = await prisma.$transaction(async (transaction) => {
    const now = new Date();
    const event = await transaction.outboxEvent.create({
      data: {
        type: REPOSITORY_PROVISION_EVENT_TYPE,
        aggregateType: 'Application',
        aggregateId: applicationId,
        idempotencyKey: `repository-provision:${applicationId}`,
        payload: {
          applicationId,
          programId,
          teamId,
          requestedAt: now.toISOString(),
          collaboratorGithubLogins: ['synthetic-relink-user'],
          repositoryConnectionMode: 'NEW',
          repositoryUrl: null,
        },
        availableAt: now,
      },
    });
    await transferProvisionGeneration(
      transaction,
      { applicationId, newEventId: event.id, now },
      parseRepositoryProvisionEvent,
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
  // When
  await service.updateMine(githubId, programId, {
    ...input,
    repositoryUrl: 'https://github.com/synthetic-org/target',
  });
  // Then: 연결만 바뀐다 — 새 발급 요청도, 초대도 없다.
  expect(
    await prisma.application.findUnique({ where: { id: applicationId } }),
  ).toMatchObject({
    repositoryConnectionMode: RepositoryConnectionMode.OWN,
    repositoryUrl: 'https://github.com/synthetic-org/target',
  });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({
    applicationId,
    source: RepositorySource.ORG_PROVISIONED,
  });
  expect(
    await prisma.outboxEvent.findMany({
      where: { aggregateId: applicationId },
      select: { id: true },
    }),
  ).toEqual([{ id: pending.id }]);
  expect(
    await prisma.repositoryInvitation.count({
      where: { repositoryId: targetId },
    }),
  ).toBe(0);
  // job은 새 세대 없이 완료로 남아 worker가 다시 집지 않고, 진행 중이던 요청은
  // 직접 연결에 밀려 SUPERSEDED로 닫힌다.
  expect(
    await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { applicationId },
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
  ).toMatchObject({ applicationId: null, programId, teamId });
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
    where: { targetId: applicationId },
  });
  const history = rows.map((row) =>
    parseApplicationRepositoryUrlAuditMetadata(row.metadata),
  );
  expect(history).toHaveLength(2);
  const first = history.find((entry) => entry?.before.repositoryId === oldId);
  const second = history.find(
    (entry) => entry?.before.repositoryId === first?.after.repositoryId,
  );
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  expect(
    await prisma.githubRepository.findUnique({ where: { applicationId } }),
  ).toMatchObject({ id: second?.after.repositoryId });
});

it('rejects a repository carrying another program history without detaching the current binding', async () => {
  const otherProgramId = `${programId}-foreign`;
  await prisma.program.create({
    data: {
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
  await prisma.githubRepository.update({
    where: { id: targetId },
    data: { programId: otherProgramId },
  });
  await expect(
    service.updateMine(githubId, programId, input),
  ).rejects.toMatchObject({ errorCode: { code: 'APP_029' } });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ applicationId });
  expect(
    await prisma.auditLog.count({ where: { targetId: applicationId } }),
  ).toBe(0);
});

it('rejects another team history that lands on the target after it was read', async () => {
  // Given: B는 읽을 때 비어 있지만, 이 요청이 A를 떼려고 기다리는 사이 다른 팀이
  // B를 거쳐 가서 그 팀의 programId·teamId가 남는다.
  const otherProgramId = `${programId}-race`;
  const otherTeamId = `${teamId}-race`;
  const { id: leaderId } = await prisma.user.findUniqueOrThrow({
    where: { githubId },
  });
  await prisma.program.create({
    data: {
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
      joinCodeDigest: `${otherTeamId}-digest`,
      leaderId,
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
      data: { programId: otherProgramId, teamId: otherTeamId },
    });
  });
  await locked;
  // When
  const relink = service.updateMine(githubId, programId, input).then(
    () => 'linked',
    (error: unknown) => error,
  );
  await waitForGithubRepositoryUpdateWaiter();
  release();
  await otherTeam;
  // Then
  expect(await relink).toMatchObject({ errorCode: { code: 'APP_029' } });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({
    applicationId: null,
    programId: otherProgramId,
    teamId: otherTeamId,
  });
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ applicationId });
  expect(
    await prisma.auditLog.count({ where: { targetId: applicationId } }),
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
    await prisma.auditLog.count({ where: { targetId: applicationId } }),
  ).toBe(0);
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({ applicationId });
});
