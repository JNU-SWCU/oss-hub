import { RepositoryProvisionJobStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { parseApplicationRepositoryUrlAuditMetadata } from '../audit-log/application-repository-url-audit-metadata';
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
  // Given
  const reason = 'Moved repository\nPreserve project history';
  // When
  await service.updateMine(githubId, programId, { ...input, reason });
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
  });
  expect(
    await prisma.auditLog.findMany({ where: { targetId: applicationId } }),
  ).toMatchObject([
    {
      action: 'APPLICATION_REPOSITORY_URL_CHANGED',
      metadata: { reason },
    },
  ]);
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
  ).toMatchObject({ repositoryUrl: null });
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
  ).toMatchObject({ repositoryProvisioning: { jobStatus: 'SUCCEEDED' } });
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
