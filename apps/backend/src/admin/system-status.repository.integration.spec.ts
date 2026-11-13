import { PlatformRepository } from '../platform/platform.repository';
import { RepoLedgerRepository } from '../platform/repo-ledger.repository';
import { CollectionScheduleService } from '../github/collection-schedule.service';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
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

it('drops a detached organization repository from the tracked set so its missing streams stop reading as partial', async () => {
  const before = (await statusService.getStatus()).collection;

  await service.updateMine(githubId, programId, input);

  const after = (await statusService.getStatus()).collection;
  expect(after.trackedRepositoryCount).toBe(before.trackedRepositoryCount - 1);

  expect(after.partialStreamCount).toBe(before.partialStreamCount - 4);
});

it('counts the new external link instead of the detached external one', async () => {
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { source: 'EXTERNAL_PUBLIC' },
  });
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
  const linked = await status.getExternalCollectionStatus();

  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { teamId: null },
  });

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
      lastSuccessAt: succeededAt,
    },
  });

  const unwritten = await status.getExternalCollectionStatus();
  expect(unwritten.lastSuccessAt).not.toEqual(succeededAt);

  await new RepoLedgerRepository().write(prisma, targetGithubId + 1n);

  const linked = await status.getExternalCollectionStatus();
  expect(linked.lastSuccessAt).toEqual(succeededAt);

  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { teamId: null },
  });

  const cleared = await status.getExternalCollectionStatus();
  expect(cleared.lastSuccessAt).not.toEqual(succeededAt);
});
