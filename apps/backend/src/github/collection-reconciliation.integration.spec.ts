import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  createCollectionAppRuntime,
  SYNTHETIC_APP_ID,
  syntheticRepository,
} from '../../test/collection-app.fixture';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionCanonicalRepository } from './collection-canonical.repository';
import { CollectionReconciliationService } from './collection-reconciliation.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const appId = BigInt(SYNTHETIC_APP_ID);
const organizationLogin = 'synthetic-org';
const initial = new Date('2026-02-01T00:00:00.000Z');

const waitForRun = async (
  repository: CollectionCanonicalRepository,
  runId: string,
  status: string,
): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await repository.getStatusSnapshot({
      appId,
      organizationLogin,
    });
    if (snapshot?.runId === runId && snapshot.runStatus === status) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Synthetic run ${runId} did not reach ${status}`);
};

describe('CollectionReconciliationService integration', () => {
  const prisma = new PrismaService();
  const repository = new CollectionCanonicalRepository(prisma);

  beforeAll(() => prisma.$connect(), 60_000);
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CanonicalCollectionLease" WHERE "appId" = $1',
      appId,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CanonicalOrganizationState" WHERE "appId" = $1',
      appId,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CanonicalCollectionRun" WHERE "appId" = $1',
      appId,
    );
  });
  afterAll(() => prisma.$disconnect());

  it('never publishes a candidate when inventory collection fails', async () => {
    const activeRunId = 'synthetic-prior-active';
    await repository.createCandidate({
      appId,
      organizationLogin,
      runId: activeRunId,
      checkedAt: initial,
    });
    const activeLease = await repository.acquireLease({
      appId,
      organizationLogin,
      runId: activeRunId,
      ownerId: 'synthetic-seed-owner',
      now: initial,
      expiresAt: new Date(initial.getTime() + 1_000),
    });
    expect(activeLease).not.toBeNull();
    await repository.markValidity(activeLease!, initial, {
      installationValid: true,
      permissionsValid: true,
    });
    await repository.writeGeneration(activeLease!, initial, {
      repositories: [],
      commits: [],
      pullRequests: [],
      releases: [],
      contributors: [],
    });
    await repository.completeAndPublish(activeLease!, initial);

    const runtime = createCollectionAppRuntime({
      repositories: [syntheticRepository()],
      commits: {},
      pullRequests: {},
      releases: {},
    });
    jest
      .spyOn(runtime.client, 'getRepository')
      .mockRejectedValueOnce(new Error('synthetic inventory failure'));
    const runId = 'synthetic-inventory-failure';
    const service = new CollectionReconciliationService(
      repository,
      () => runtime,
      () => new Date('2026-02-01T00:01:00.000Z'),
      () => runId,
    );

    await service.trigger('synthetic-worker');
    await waitForRun(repository, runId, 'FAILED');

    const snapshot = await repository.getStatusSnapshot({
      appId,
      organizationLogin,
    });
    expect(snapshot).toMatchObject({
      activeGenerationId: activeRunId,
      runId,
      runStatus: 'FAILED',
      errorClass: 'COLLECTION_FAILED',
    });
    const publishedRows = await prisma.$queryRawUnsafe<unknown[]>(
      'SELECT 1 FROM "CanonicalRepository" WHERE "generationId" = $1',
      runId,
    );
    expect(publishedRows).toHaveLength(0);
  });
});
