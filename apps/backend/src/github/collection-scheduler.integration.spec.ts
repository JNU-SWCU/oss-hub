import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';

import { CollectionCutoverRepository } from './repository-provision-job.repository';
import { CollectionTriggerService } from './collection-trigger.service';
import { CollectionSyncService } from './collection-sync.service';
import {
  CollectionUserActivityService,
  type CollectionUserActivitySweepResult,
} from './collection-user-activity.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

describe('GithubScheduler integration', () => {
  const prisma = new PrismaService();
  const leaseKey = { appId: 9_000_000_740_001n, scope: 'synthetic-scheduler' };
  const cutover = new CollectionCutoverRepository(prisma);
  let testingModule: TestingModule;
  let scheduler: CollectionTriggerService;
  const run = jest.fn<
    Promise<{ runId: string; status: 'COMPLETED' }>,
    [string]
  >();
  const runExternal = jest.fn<
    Promise<{ runId: string; status: 'COMPLETED' }>,
    [string]
  >();
  const runUserActivity = jest.fn<
    Promise<CollectionUserActivitySweepResult>,
    []
  >();

  beforeAll(async () => {
    await prisma.$connect();
    testingModule = await Test.createTestingModule({
      providers: [
        CollectionTriggerService,
        { provide: CollectionSyncService, useValue: { run, runExternal } },
        { provide: CollectionCutoverRepository, useValue: cutover },
        {
          provide: CollectionUserActivityService,
          useValue: { run: runUserActivity },
        },
      ],
    }).compile();
    scheduler = testingModule.get(CollectionTriggerService);
  });

  afterEach(async () => {
    await prisma.collectionCutoverLease.deleteMany({ where: leaseKey });
    run.mockReset();
    runExternal.mockReset();
    runUserActivity.mockReset();
  });

  afterAll(async () => {
    await testingModule.close();
    await prisma.$disconnect();
  });

  it('스케줄 실행을 증분 sync writer로 전달하고 PENDING 응답을 즉시 보존한다', async () => {
    run.mockResolvedValue({
      runId: 'synthetic-scheduler-run-id',
      status: 'COMPLETED',
    });
    runExternal.mockResolvedValue({
      runId: 'synthetic-scheduler-external-run-id',
      status: 'COMPLETED',
    });
    runUserActivity.mockResolvedValue({
      observedUserCount: 0,
      upsertedRowCount: 0,
      skippedPastYearCount: 0,
      failedUserCount: 0,
    });

    const result = await scheduler.trigger();
    expect(result.status).toBe('PENDING');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toMatch(/^scheduler:/);
    expect(runExternal).toHaveBeenCalledTimes(1);
    expect(runExternal.mock.calls[0]?.[0]).toBe(run.mock.calls[0]?.[0]);
  });

  it('COL_008 quiesce 거부를 변경 없이 전파한다', async () => {
    await prisma.collectionCutoverLease.create({
      data: {
        ...leaseKey,
        ownerId: 'synthetic-owner',
        runId: 'synthetic-active-run',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(scheduler.trigger()).rejects.toMatchObject({
      errorCode: { code: 'COL_008', status: 409 },
    });
    expect(run).not.toHaveBeenCalled();
    expect(runExternal).not.toHaveBeenCalled();
    expect(runUserActivity).not.toHaveBeenCalled();
  });
  it('실제 lease는 만료 경계부터 수집을 차단하지 않는다', async () => {
    const expiresAt = new Date('2026-10-01T00:00:00.000Z');
    await prisma.collectionCutoverLease.create({
      data: {
        ...leaseKey,
        ownerId: 'synthetic-owner',
        runId: 'synthetic-expired-run',
        expiresAt,
      },
    });
    await expect(
      cutover.isQuiesced(new Date(expiresAt.getTime() - 1)),
    ).resolves.toBe(true);
    await expect(cutover.isQuiesced(expiresAt)).resolves.toBe(false);
    await expect(
      cutover.isQuiesced(new Date(expiresAt.getTime() + 1)),
    ).resolves.toBe(false);
  });
});
