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
  COLLECTION_TRIGGERS,
  CollectionRun,
  CollectionTrigger,
  CollectionUser,
} from './domain/collection-run';
import { GithubObservation } from './domain/github-observation';
import { GithubApiClient } from './github-api.client';
import { RateLimitedError } from './github-api.error';

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
  ) {}

  async runSelf(githubId: bigint): Promise<CollectionRun> {
    const user = await this.repository.findUserByGithubId(githubId);
    if (!user) {
      throw new CollectionTargetNotFoundError();
    }
    return this.collect(user, COLLECTION_TRIGGERS.SELF);
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

      const run = await this.collect(
        target,
        COLLECTION_TRIGGERS.BATCH,
        profiles,
      );
      runs.push(run);
      if (run.status === COLLECTION_RUN_STATUSES.RATE_LIMITED) {
        break;
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
    user: CollectionUser,
    trigger: CollectionTrigger,
    prefetchedProfiles?: GithubObservation[],
  ): Promise<CollectionRun> {
    const run = await this.repository.createRun(user, trigger);

    try {
      const profiles =
        prefetchedProfiles ??
        (await this.githubApiClient.getUser(user.login));
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
        return this.repository.markRateLimited(
          run.id,
          error.retryNotBeforeAt,
        );
      }

      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(`GitHub collection failed: ${errorName}`);
      return this.repository.markFailed(run.id);
    }
  }
}
