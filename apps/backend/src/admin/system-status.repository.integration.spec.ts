import { PlatformRepository } from '../platform/platform.repository';
import { RepoLedgerRepository } from '../platform/repo-ledger.repository';
import { CollectionScheduleService } from '../github/collection-schedule.service';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { syncGithubRepositoryLedger } from '../../test/repo-ledger.fixture';
import {
  prisma,
  service,
  githubId,
  programId,
  oldId,
  targetGithubId,
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
});
afterAll(async () => {
  await prisma.admin.deleteMany({ where: { userId: ADMIN_ID } });
  await prisma.user.deleteMany({ where: { id: ADMIN_ID } });
});

it('drops a detached organization repository from the tracked set', async () => {
  const before = await status.getCollectionRepositories();

  await service.updateMine(githubId, programId, input);

  const after = await status.getCollectionRepositories();
  expect(after).toHaveLength(before.length - 1);
});

it('reads each tracked organization repository success time from the repo ledger', async () => {
  const succeededAt = new Date('2099-02-01T00:00:00.000Z');
  const tracked = await prisma.githubRepository.findUniqueOrThrow({
    where: { id: oldId },
    select: { githubRepositoryId: true, nameWithOwner: true },
  });
  await new RepoLedgerRepository().write(prisma, tracked.githubRepositoryId);
  await prisma.repo.update({
    where: { githubRepoId: tracked.githubRepositoryId },
    data: { lastSuccessAt: succeededAt },
  });

  const repositories = await status.getCollectionRepositories();

  expect(
    repositories
      .filter(
        (repository) => repository.repositoryName === tracked.nameWithOwner,
      )
      .map((repository) => repository.lastSuccessAt),
  ).toContainEqual(succeededAt);
  expect((await statusService.getStatus()).collection.lastSuccessAt).toEqual(
    succeededAt,
  );
});

it('counts the new external link instead of the detached external one', async () => {
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { source: 'EXTERNAL_PUBLIC' },
  });
  await syncGithubRepositoryLedger(prisma, targetGithubId + 1n);
  const before = await status.getExternalCollectionStatus();

  await service.updateMine(githubId, programId, input);

  const after = await status.getExternalCollectionStatus();
  expect(after.trackedRepositoryCount).toBe(before.trackedRepositoryCount);
});

it('drops an external repository from the tracked count once deletion clears its links', async () => {
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: {
      source: 'EXTERNAL_PUBLIC',
      presence: 'PRESENT',
      visibility: 'PUBLIC',
    },
  });
  await syncGithubRepositoryLedger(prisma, targetGithubId + 1n);
  const linked = await status.getExternalCollectionStatus();

  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { teamId: null },
  });
  await syncGithubRepositoryLedger(prisma, targetGithubId + 1n);

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
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: {
      source: 'EXTERNAL_PUBLIC',
      presence: 'PRESENT',
      visibility: 'PUBLIC',
    },
  });
  await new RepoLedgerRepository().write(prisma, targetGithubId + 1n);
  await prisma.repo.update({
    where: { githubRepoId: targetGithubId + 1n },
    data: { lastSuccessAt: succeededAt },
  });

  const linked = await status.getExternalCollectionStatus();
  expect(linked.lastSuccessAt).toEqual(succeededAt);

  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { teamId: null },
  });
  await syncGithubRepositoryLedger(prisma, targetGithubId + 1n);

  const cleared = await status.getExternalCollectionStatus();
  expect(cleared.lastSuccessAt).not.toEqual(succeededAt);
});
