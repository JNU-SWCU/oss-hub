import { Injectable, Logger } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from './collection-error-code.enum';
import { CollectionConfig } from './collection.config';
import { CollectionRepository } from './collection.repository';
import {
  COLLECTION_RUN_STATUSES,
  COLLECTION_RUN_START_KINDS,
  COLLECTION_TRIGGERS,
  CollectionRun,
  CollectionUser,
} from './domain/collection-run';
import { GithubObservation } from './domain/github-observation';
import { GithubApiClient } from './github-api.client';
import { RateLimitedError } from './github-api.error';
import { CollectionRunStarter } from './collection-run-starter.service';

class CollectionTargetNotFoundError extends Error {
  override readonly name = 'CollectionTargetNotFoundError';

  constructor() {
    super('Collection target user was not found');
  }
}

@Injectable()
export class CollectionService {
  private readonly logger = new Logger(CollectionService.name);

  constructor(
    private readonly config: CollectionConfig,
    private readonly repository: CollectionRepository,
    private readonly githubApiClient: GithubApiClient,
    private readonly runStarter: CollectionRunStarter,
  ) {}

  async runSelf(githubId: bigint): Promise<CollectionRun> {
    if (!this.config.legacyUserCollectionEnabled) {
      throw new DomainException(
        COLLECTION_ERROR_CODES[CollectionErrorCode.COLLECTION_SCOPE_DISABLED],
      );
    }
    const user = await this.repository.findUserByGithubId(githubId);
    if (!user) {
      throw new CollectionTargetNotFoundError();
    }
    const startResult = await this.runStarter.start(
      user,
      COLLECTION_TRIGGERS.SELF,
    );
    switch (startResult.kind) {
      case COLLECTION_RUN_START_KINDS.STARTED:
        return this.collect(startResult.run, user);
      case COLLECTION_RUN_START_KINDS.REJECTED:
        throw new DomainException(
          COLLECTION_ERROR_CODES[CollectionErrorCode.COLLECTION_RUN_NOT_READY],
          {
            retryNotBeforeAt: startResult.retryNotBeforeAt.toISOString(),
          },
        );
      default:
        return startResult;
    }
  }

  async runBatch(logins: string[]): Promise<CollectionRun[]> {
    const allowlist = new Set(this.config.batchLogins);
    if (logins.some((login) => !allowlist.has(login))) {
      throw new DomainException(
        COLLECTION_ERROR_CODES[CollectionErrorCode.BATCH_LOGIN_NOT_ALLOWED],
      );
    }

    const runs: CollectionRun[] = [];
    for (const login of logins) {
      // batch 대상은 로그인 이력과 무관하다 — 신원(githubId)은 GitHub 프로필에서 해석한다.
      // 이 단계의 rate limit은 run 행이 생기기 전이므로 기록 없이 배치를 중단한다.
      let profiles: GithubObservation[];
      try {
        profiles = await this.githubApiClient.getUser(login);
      } catch (error) {
        if (error instanceof RateLimitedError) {
          this.logger.warn(
            'Batch collection rate limited while resolving a target — remaining targets skipped',
          );
          break;
        }
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        this.logger.error(`Batch target resolution failed: ${errorName}`);
        continue;
      }

      const target = this.toTarget(login, profiles);
      if (!target) {
        this.logger.error('Batch target resolution failed: InvalidProfileId');
        continue;
      }

      const startResult = await this.runStarter.start(
        target,
        COLLECTION_TRIGGERS.BATCH,
      );
      switch (startResult.kind) {
        case COLLECTION_RUN_START_KINDS.REJECTED:
          this.logger.warn(
            'Batch collection target skipped because collection is already running or cooling down',
          );
          continue;
        case COLLECTION_RUN_START_KINDS.STARTED: {
          const run = await this.collect(startResult.run, target, profiles);
          runs.push(run);
          if (run.status === COLLECTION_RUN_STATUSES.RATE_LIMITED) {
            return runs;
          }
          break;
        }
        default:
          return startResult;
      }
    }
    return runs;
  }

  private toTarget(
    login: string,
    profiles: GithubObservation[],
  ): CollectionUser | null {
    const sourceId = profiles[0]?.sourceId;
    if (!sourceId || !/^[0-9]{1,19}$/.test(sourceId)) {
      return null;
    }
    return { githubId: BigInt(sourceId), login };
  }

  private async collect(
    run: CollectionRun,
    user: CollectionUser,
    prefetchedProfiles?: GithubObservation[],
  ): Promise<CollectionRun> {
    try {
      const profiles =
        prefetchedProfiles ?? (await this.githubApiClient.getUser(user.login));
      const repositories = await this.githubApiClient.getRepos(user.login);
      const events = await this.githubApiClient.getPublicEvents(user.login);
      return await this.repository.markSucceeded({
        runId: run.id,
        profiles,
        repositories,
        events,
      });
    } catch (error) {
      if (error instanceof RateLimitedError) {
        return this.repository.markRateLimited(run.id, error.retryNotBeforeAt);
      }

      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(`GitHub collection failed: ${errorName}`);
      return this.repository.markFailed(run.id);
    }
  }
}
