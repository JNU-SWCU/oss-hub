import { Test, TestingModule } from '@nestjs/testing';

import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionConfig } from './collection.config';
import { CollectionRepository } from './collection.repository';
import { CollectionRunStarter } from './collection-run-starter.service';
import { CollectionSchedulerService } from './collection-scheduler.service';
import { CollectionService } from './collection.service';
import {
  COLLECTION_RUN_STATUSES,
  COLLECTION_TRIGGERS,
} from './domain/collection-run';
import { GithubObservation } from './domain/github-observation';
import { GithubApiClient } from './github-api.client';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const syntheticGithubId = 9_000_000_000_000_151n;
const syntheticLogin = 'synthetic-scheduler-user';
const profile: GithubObservation[] = [
  {
    sourceId: syntheticGithubId.toString(),
    payload: { id: syntheticGithubId.toString(), login: syntheticLogin },
  },
];
const repositories: GithubObservation[] = [
  { sourceId: '15101', payload: { id: 15101, name: 'synthetic-repo' } },
];
const events: GithubObservation[] = [
  { sourceId: 'event-151', payload: { id: 'event-151', type: 'PushEvent' } },
];

describe('CollectionScheduler integration', () => {
  let testingModule: TestingModule;
  let prisma: PrismaService;
  let scheduler: CollectionSchedulerService;
  const getUser = jest.fn<Promise<GithubObservation[]>, [string]>();
  const getRepos = jest.fn<Promise<GithubObservation[]>, [string]>();
  const getPublicEvents = jest.fn<Promise<GithubObservation[]>, [string]>();

  beforeAll(async () => {
    testingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        CollectionRepository,
        CollectionRunStarter,
        CollectionService,
        CollectionSchedulerService,
        {
          provide: CollectionConfig,
          useValue: { batchLogins: [syntheticLogin] },
        },
        {
          provide: GithubApiClient,
          useValue: { getUser, getRepos, getPublicEvents },
        },
      ],
    }).compile();
    await testingModule.init();
    prisma = testingModule.get(PrismaService);
    scheduler = testingModule.get(CollectionSchedulerService);
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(() => {
    getUser.mockResolvedValue(profile);
    getRepos.mockResolvedValue(repositories);
    getPublicEvents.mockResolvedValue(events);
  });

  afterEach(async () => {
    const runs = await prisma.collectionRun.findMany({
      where: { targetGithubId: syntheticGithubId },
      select: { id: true },
    });
    await prisma.githubRawObservation.deleteMany({
      where: { runId: { in: runs.map((run) => run.id) } },
    });
    await prisma.collectionRun.deleteMany({
      where: { targetGithubId: syntheticGithubId },
    });
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await testingModule.close();
  });

  it('스케줄 실행이 기존 batch 파이프라인으로 BATCH run과 관측값을 저장한다', async () => {
    const execution = scheduler.trigger();
    await execution.completion;

    const run = await prisma.collectionRun.findFirstOrThrow({
      where: { targetGithubId: syntheticGithubId },
      include: { observations: true },
    });
    expect(run).toMatchObject({
      targetLogin: syntheticLogin,
      trigger: COLLECTION_TRIGGERS.BATCH,
      status: COLLECTION_RUN_STATUSES.SUCCEEDED,
      profileCount: 1,
      repoCount: 1,
      eventCount: 1,
    });
    expect(run.observations).toHaveLength(3);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getRepos).toHaveBeenCalledWith(syntheticLogin);
    expect(getPublicEvents).toHaveBeenCalledWith(syntheticLogin);
  });
});
