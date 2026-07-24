import { Injectable } from '@nestjs/common';
import { RepositoryOwnerRepository } from '../repository-ownership/repository-owner.repository';
import {
  RANKING_NOTICE,
  RANKING_PERIODS,
  type RankingEntry,
  type RankingMetrics,
  type RankingPage,
  type RankingPeriod,
} from './domain/ranking';
import {
  addRankingMetrics,
  emptyRankingMetrics,
  isNewerIdentity,
  isWithinRankingPeriod,
  parseRankingEvent,
  rankingYearInAsiaSeoul,
  rankingYearStartInAsiaSeoul,
  type CanonicalIdentity,
} from './domain/ranking-event';
import { RankingRepository } from './ranking.repository';

const RANKING_CACHE_TTL_MS = 60_000;

interface CachedRanking {
  readonly entries: readonly RankingEntry[];
  readonly expiresAt: number;
}

@Injectable()
export class RankingService {
  private readonly cache = new Map<string, CachedRanking>();
  private readonly inFlightBuilds = new Map<
    string,
    Promise<readonly RankingEntry[]>
  >();

  constructor(
    private readonly repository: RankingRepository,
    private readonly ownerRepository: RepositoryOwnerRepository,
  ) {}

  async findPage(
    period: RankingPeriod,
    page: number,
    pageSize: number,
    now: Date = new Date(),
  ): Promise<RankingPage> {
    const entries = await this.findEntries(period, now);
    const start = (page - 1) * pageSize;
    return {
      notice: RANKING_NOTICE,
      period,
      items: entries.slice(start, start + pageSize),
      page,
      pageSize,
      total: entries.length,
    };
  }

  private async findEntries(
    period: RankingPeriod,
    now: Date,
  ): Promise<readonly RankingEntry[]> {
    const currentYear = rankingYearInAsiaSeoul(now);
    const cacheKey =
      period === RANKING_PERIODS.ALL ? period : `${period}:${currentYear}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.entries;
    }

    const existingBuild = this.inFlightBuilds.get(cacheKey);
    if (existingBuild) {
      return existingBuild;
    }

    const build = this.buildEntries(period, currentYear)
      .then((entries) => {
        this.cache.set(cacheKey, {
          entries,
          expiresAt: Date.now() + RANKING_CACHE_TTL_MS,
        });
        return entries;
      })
      .finally(() => this.inFlightBuilds.delete(cacheKey));
    this.inFlightBuilds.set(cacheKey, build);
    return build;
  }

  private async buildEntries(
    period: RankingPeriod,
    currentYear: number,
  ): Promise<readonly RankingEntry[]> {
    const repositoryIds = new Set<string>();
    const ownersByRepositoryId = new Map<
      string,
      { readonly githubId: string; readonly login: string }
    >();
    for await (const batch of this.repository.findPlatformRepositoryIdBatches()) {
      for (const repositoryId of batch) {
        repositoryIds.add(repositoryId);
      }
      const owners = await this.ownerRepository.findByGithubRepositoryIds(
        batch.map((repositoryId) => BigInt(repositoryId)),
      );
      for (const owner of owners) {
        ownersByRepositoryId.set(String(owner.githubRepositoryId), {
          githubId: String(owner.ownerGithubId),
          login: owner.ownerGithubLogin,
        });
      }
    }
    const metricsByGithubId = new Map<string, RankingMetrics>();
    const identitiesByGithubId = new Map<string, CanonicalIdentity>();
    const ownerLoginsByGithubId = new Map<string, string>();
    const fetchedAtOrAfter =
      period === RANKING_PERIODS.THIS_YEAR
        ? rankingYearStartInAsiaSeoul(currentYear)
        : undefined;
    let previousSourceId: string | undefined;

    for await (const batch of this.repository.findObservationBatches(
      fetchedAtOrAfter,
    )) {
      for (const observation of batch) {
        if (observation.sourceId === previousSourceId) {
          continue;
        }
        previousSourceId = observation.sourceId;
        const event = parseRankingEvent(observation.payload);
        if (
          !event ||
          !repositoryIds.has(event.repositoryId) ||
          !isWithinRankingPeriod(event.occurredAt, period, currentYear)
        ) {
          continue;
        }

        const owner = ownersByRepositoryId.get(event.repositoryId);
        if (event.type === 'WatchEvent' && !owner) {
          continue;
        }
        const githubId =
          event.type === 'WatchEvent' && owner
            ? owner.githubId
            : observation.targetGithubId;
        const login =
          event.type === 'WatchEvent' && owner
            ? owner.login
            : observation.targetLogin;
        const currentIdentity = identitiesByGithubId.get(githubId);
        if (event.type === 'WatchEvent') {
          ownerLoginsByGithubId.set(githubId, login);
        }
        if (
          event.type === 'WatchEvent' ||
          isNewerIdentity(observation, currentIdentity)
        ) {
          identitiesByGithubId.set(githubId, {
            login,
            runId: observation.runId,
            runStartedAt: observation.runStartedAt,
          });
        }
        metricsByGithubId.set(
          githubId,
          addRankingMetrics(
            metricsByGithubId.get(githubId) ?? emptyRankingMetrics(),
            event.metrics,
          ),
        );
      }
    }

    return this.toEntries(
      metricsByGithubId,
      identitiesByGithubId,
      ownerLoginsByGithubId,
    );
  }

  private toEntries(
    metricsByGithubId: ReadonlyMap<string, RankingMetrics>,
    identitiesByGithubId: ReadonlyMap<string, CanonicalIdentity>,
    ownerLoginsByGithubId: ReadonlyMap<string, string>,
  ): RankingEntry[] {
    return [...metricsByGithubId.entries()]
      .map(([githubId, metrics]) => {
        const login =
          ownerLoginsByGithubId.get(githubId) ??
          identitiesByGithubId.get(githubId)?.login ??
          githubId;
        return {
          githubId,
          rank: 0,
          displayName: login,
          githubLogin: login,
          ...metrics,
          total: metrics.commitCount + metrics.prCount + metrics.starCount,
        };
      })
      .filter((entry) => entry.total > 0)
      .sort(
        (left, right) =>
          right.total - left.total ||
          right.commitCount - left.commitCount ||
          right.prCount - left.prCount ||
          right.starCount - left.starCount ||
          left.githubLogin.localeCompare(right.githubLogin) ||
          left.githubId.localeCompare(right.githubId),
      )
      .map((entry, index) => ({
        rank: index + 1,
        displayName: entry.displayName,
        githubLogin: entry.githubLogin,
        commitCount: entry.commitCount,
        prCount: entry.prCount,
        starCount: entry.starCount,
        total: entry.total,
      }));
  }
}
