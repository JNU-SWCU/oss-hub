import { Logger } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import { CollectionErrorCode } from './collection-error-code.enum';
import { CollectionConfig } from './collection.config';
import { CollectionRepository } from './collection.repository';
import {
  COLLECTION_RUN_STATUSES,
  COLLECTION_TRIGGERS,
  CollectionRun,
  CollectionUser,
} from './domain/collection-run';
import { GithubObservation } from './domain/github-observation';
import { GithubApiClient } from './github-api.client';
import { RateLimitedError } from './github-api.error';
import { CollectionService } from './collection.service';

const syntheticUser: CollectionUser = {
  githubId: 424242n,
  login: 'synthetic-login',
};

const runningRun: CollectionRun = {
  id: 'synthetic-run-id',
  targetGithubId: syntheticUser.githubId,
  targetLogin: syntheticUser.login,
  trigger: COLLECTION_TRIGGERS.SELF,
  status: COLLECTION_RUN_STATUSES.RUNNING,
  profileCount: 0,
  repoCount: 0,
  eventCount: 0,
  retryNotBeforeAt: null,
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  finishedAt: null,
};

const profile: GithubObservation[] = [
  { sourceId: '424242', payload: { id: 424242, login: 'synthetic-login' } },
];
const repositories: GithubObservation[] = [
  { sourceId: '101', payload: { id: 101, name: 'synthetic-repo' } },
];
const events: GithubObservation[] = [
  { sourceId: 'event-1', payload: { id: 'event-1', type: 'SyntheticEvent' } },
];

describe('CollectionService', () => {
  let repository: jest.Mocked<
    Pick<
      CollectionRepository,
      | 'findUserByGithubId'
      | 'createRun'
      | 'markSucceeded'
      | 'markRateLimited'
      | 'markFailed'
    >
  >;
  let githubApiClient: jest.Mocked<
    Pick<GithubApiClient, 'getUser' | 'getRepos' | 'getPublicEvents'>
  >;

  function buildService(batchLogins = ['synthetic-login']): CollectionService {
    const config = { batchLogins } as unknown as CollectionConfig;
    return new CollectionService(
      config,
      repository as unknown as CollectionRepository,
      githubApiClient as unknown as GithubApiClient,
    );
  }

  beforeEach(() => {
    repository = {
      findUserByGithubId: jest.fn(),
      createRun: jest.fn(),
      markSucceeded: jest.fn(),
      markRateLimited: jest.fn(),
      markFailed: jest.fn(),
    };
    githubApiClient = {
      getUser: jest.fn(),
      getRepos: jest.fn(),
      getPublicEvents: jest.fn(),
    };
  });

  it('runSelf는 run 생성 후 세 소스를 순서대로 fetch하고 마지막에 성공 저장한다', async () => {
    const order: string[] = [];
    const succeededRun: CollectionRun = {
      ...runningRun,
      status: COLLECTION_RUN_STATUSES.SUCCEEDED,
      profileCount: 1,
      repoCount: 1,
      eventCount: 1,
      finishedAt: new Date('2026-01-01T00:00:03.000Z'),
    };
    repository.findUserByGithubId.mockImplementation(() => {
      order.push('find-user');
      return Promise.resolve(syntheticUser);
    });
    repository.createRun.mockImplementation(() => {
      order.push('create-run');
      return Promise.resolve(runningRun);
    });
    githubApiClient.getUser.mockImplementation(() => {
      order.push('fetch-profile');
      return Promise.resolve(profile);
    });
    githubApiClient.getRepos.mockImplementation(() => {
      order.push('fetch-repositories');
      return Promise.resolve(repositories);
    });
    githubApiClient.getPublicEvents.mockImplementation(() => {
      order.push('fetch-events');
      return Promise.resolve(events);
    });
    repository.markSucceeded.mockImplementation(() => {
      order.push('save-success');
      return Promise.resolve(succeededRun);
    });

    const result = await buildService().runSelf(syntheticUser.githubId);

    expect(result).toEqual(succeededRun);
    expect(order).toEqual([
      'find-user',
      'create-run',
      'fetch-profile',
      'fetch-repositories',
      'fetch-events',
      'save-success',
    ]);
    expect(repository.markSucceeded).toHaveBeenCalledWith({
      runId: runningRun.id,
      profiles: profile,
      repositories,
      events,
    });
  });

  it('rate limit이면 run을 RATE_LIMITED로 저장하고 실패 상태로 덮지 않는다', async () => {
    const retryNotBeforeAt = new Date('2026-01-01T00:01:00.000Z');
    const rateLimitedRun: CollectionRun = {
      ...runningRun,
      status: COLLECTION_RUN_STATUSES.RATE_LIMITED,
      retryNotBeforeAt,
      finishedAt: new Date('2026-01-01T00:00:01.000Z'),
    };
    repository.findUserByGithubId.mockResolvedValue(syntheticUser);
    repository.createRun.mockResolvedValue(runningRun);
    githubApiClient.getUser.mockRejectedValue(
      new RateLimitedError(retryNotBeforeAt),
    );
    repository.markRateLimited.mockResolvedValue(rateLimitedRun);

    const result = await buildService().runSelf(syntheticUser.githubId);

    expect(result).toEqual(rateLimitedRun);
    expect(repository.markRateLimited).toHaveBeenCalledWith(
      runningRun.id,
      retryNotBeforeAt,
    );
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('batch에 allowlist 밖 login이 하나라도 있으면 어떤 계정도 실행하지 않는다', async () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = buildService(['synthetic-login']);

    const promise = service.runBatch([
      'synthetic-login',
      'outside-allowlist-login',
    ]);

    await expect(promise).rejects.toMatchObject({
      errorCode: { code: CollectionErrorCode.BATCH_LOGIN_NOT_ALLOWED },
    });
    await expect(promise).rejects.toBeInstanceOf(DomainException);
    expect(repository.createRun).not.toHaveBeenCalled();
    expect(githubApiClient.getUser).not.toHaveBeenCalled();
    logger.mockRestore();
  });

  it('batch는 로그인 이력 없이 GitHub 프로필에서 신원을 해석해 수집한다', async () => {
    const batchRun: CollectionRun = {
      ...runningRun,
      trigger: COLLECTION_TRIGGERS.BATCH,
      status: COLLECTION_RUN_STATUSES.SUCCEEDED,
      profileCount: 1,
      repoCount: 1,
      eventCount: 1,
      finishedAt: new Date('2026-01-01T00:00:03.000Z'),
    };
    githubApiClient.getUser.mockResolvedValue(profile);
    githubApiClient.getRepos.mockResolvedValue(repositories);
    githubApiClient.getPublicEvents.mockResolvedValue(events);
    repository.createRun.mockResolvedValue({
      ...runningRun,
      trigger: COLLECTION_TRIGGERS.BATCH,
    });
    repository.markSucceeded.mockResolvedValue(batchRun);

    const runs = await buildService().runBatch(['synthetic-login']);

    expect(runs).toEqual([batchRun]);
    // 신원은 DB가 아니라 프로필 관측값(sourceId)에서 왔다
    expect(repository.findUserByGithubId).not.toHaveBeenCalled();
    expect(repository.createRun).toHaveBeenCalledWith(
      { githubId: 424242n, login: 'synthetic-login' },
      COLLECTION_TRIGGERS.BATCH,
    );
    // 프로필은 재조회하지 않고 해석 시 받은 것을 재사용한다
    expect(githubApiClient.getUser).toHaveBeenCalledTimes(1);
  });

  it('batch 대상 해석 단계에서 rate limit이면 run 기록 없이 남은 계정을 중단한다', async () => {
    const logger = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    githubApiClient.getUser.mockRejectedValue(
      new RateLimitedError(new Date('2026-01-01T00:01:00.000Z')),
    );

    const runs = await buildService([
      'synthetic-login',
      'synthetic-login-2',
    ]).runBatch(['synthetic-login', 'synthetic-login-2']);

    expect(runs).toEqual([]);
    expect(githubApiClient.getUser).toHaveBeenCalledTimes(1);
    expect(repository.createRun).not.toHaveBeenCalled();
    logger.mockRestore();
  });
});
