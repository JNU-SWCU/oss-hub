import { Test } from '@nestjs/testing';
import { CollectionConfig } from './collection.config';
import { CollectionRepository } from './collection.repository';
import { CollectionRunStarter } from './collection-run-starter.service';
import { CollectionService } from './collection.service';
import {
  COLLECTION_RUN_START_KINDS,
  COLLECTION_RUN_STATUSES,
  COLLECTION_TRIGGERS,
} from './domain/collection-run';
import type { CollectionRun } from './domain/collection-run';
import { GithubApiClient } from './github-api.client';

const secondRun: CollectionRun = {
  id: 'synthetic-second-run',
  targetGithubId: 434343n,
  targetLogin: 'synthetic-second-login',
  trigger: COLLECTION_TRIGGERS.BATCH,
  status: COLLECTION_RUN_STATUSES.RUNNING,
  profileCount: 0,
  repoCount: 0,
  eventCount: 0,
  retryNotBeforeAt: null,
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  finishedAt: null,
};

describe('CollectionService batch start gate', () => {
  it('첫 대상이 실행 중이면 건너뛰고 다음 batch 대상을 수집한다', async () => {
    // Given: 첫 대상은 gate에서 거절되고 두 번째 대상은 시작할 수 있다.
    const runStarter = {
      start: jest
        .fn()
        .mockResolvedValueOnce({
          kind: COLLECTION_RUN_START_KINDS.REJECTED,
          retryNotBeforeAt: new Date('2026-01-01T00:01:00.000Z'),
        })
        .mockResolvedValueOnce({
          kind: COLLECTION_RUN_START_KINDS.STARTED,
          run: secondRun,
        }),
    };
    const repository = {
      markSucceeded: jest.fn().mockResolvedValue({
        ...secondRun,
        status: COLLECTION_RUN_STATUSES.SUCCEEDED,
        finishedAt: new Date('2026-01-01T00:00:01.000Z'),
      }),
      markRateLimited: jest.fn(),
      markFailed: jest.fn(),
    };
    const githubApiClient = {
      getUser: jest
        .fn()
        .mockResolvedValueOnce([
          { sourceId: '424242', payload: { login: 'synthetic-first-login' } },
        ])
        .mockResolvedValueOnce([
          { sourceId: '434343', payload: { login: 'synthetic-second-login' } },
        ]),
      getRepos: jest.fn().mockResolvedValue([]),
      getPublicEvents: jest.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      providers: [
        CollectionService,
        {
          provide: CollectionConfig,
          useValue: {
            batchLogins: [
              'synthetic-first-login',
              'synthetic-second-login',
            ],
          },
        },
        { provide: CollectionRepository, useValue: repository },
        { provide: CollectionRunStarter, useValue: runStarter },
        { provide: GithubApiClient, useValue: githubApiClient },
      ],
    }).compile();

    // When: 두 대상을 순서대로 batch 수집한다.
    const runs = await module.get(CollectionService).runBatch([
      'synthetic-first-login',
      'synthetic-second-login',
    ]);

    // Then: 첫 대상만 건너뛰고 두 번째 대상은 성공한다.
    expect(runs).toEqual([
      expect.objectContaining({
        id: secondRun.id,
        status: COLLECTION_RUN_STATUSES.SUCCEEDED,
      }),
    ]);
    expect(githubApiClient.getUser).toHaveBeenCalledTimes(2);
  });
});
