import { Inject, Injectable } from '@nestjs/common';
import {
  COLLECTION_READ_PORT,
  type CollectionReadPort,
} from '../collection/collection-read.port';
import { PublicProjectsService } from '../public-projects/public-projects.service';
import { RankingUserEligibilityRepository } from './ranking-user-eligibility.repository';
import {
  RANKING_YEAR_ALL,
  type RankingEntry,
  type RankingPage,
  type RankingYear,
} from './domain/ranking';

const RANKING_CACHE_TTL_MS = 60_000;

type RankingCandidate = {
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly prCount: number;
  readonly releaseCount: number;
  readonly total: number;
};

interface CachedRanking {
  readonly candidates: readonly RankingCandidate[];
  readonly expiresAt: number;
}

@Injectable()
export class RankingService {
  private readonly cache = new Map<string, CachedRanking>();
  private readonly inFlightBuilds = new Map<
    string,
    Promise<readonly RankingCandidate[]>
  >();

  constructor(
    @Inject(COLLECTION_READ_PORT)
    private readonly collection: CollectionReadPort,
    @Inject(PublicProjectsService)
    private readonly publicProjects: Pick<
      PublicProjectsService,
      'findEligibleRepositoryIds'
    >,
    @Inject(RankingUserEligibilityRepository)
    private readonly userEligibility: Pick<
      RankingUserEligibilityRepository,
      'findEligibleGithubIds'
    >,
  ) {}

  async findPage(
    year: RankingYear,
    page: number,
    pageSize: number,
  ): Promise<RankingPage> {
    const candidates = await this.findCandidates(year);
    const eligibleGithubIds = await this.userEligibility.findEligibleGithubIds(
      candidates.map((candidate) => candidate.githubId),
    );
    const entries = this.rankEntries(
      candidates.filter((candidate) =>
        eligibleGithubIds.has(candidate.githubId),
      ),
    );
    const start = (page - 1) * pageSize;
    return {
      year,
      items: entries.slice(start, start + pageSize),
      page,
      pageSize,
      total: entries.length,
    };
  }

  /**
   * Distinct calendar years that have public ranking activity (desc).
   * Used by the shell year sidebar — only years with data.
   */
  async listYears(): Promise<readonly number[]> {
    return this.collection.listPublicRankingYears();
  }

  private async findCandidates(
    year: RankingYear,
  ): Promise<readonly RankingCandidate[]> {
    const repositoryIds = await this.publicProjects.findEligibleRepositoryIds();
    const repositoryScope = [...repositoryIds]
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .join(',');
    const cacheKey =
      (year === RANKING_YEAR_ALL ? RANKING_YEAR_ALL : 'year:' + year) +
      ':' +
      repositoryScope;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.candidates;

    const existingBuild = this.inFlightBuilds.get(cacheKey);
    if (existingBuild) return existingBuild;

    const build = this.buildCandidates(year, repositoryIds)
      .then((candidates) => {
        this.cache.set(cacheKey, {
          candidates,
          expiresAt: Date.now() + RANKING_CACHE_TTL_MS,
        });
        return candidates;
      })
      .finally(() => this.inFlightBuilds.delete(cacheKey));
    this.inFlightBuilds.set(cacheKey, build);
    return build;
  }

  private async buildCandidates(
    year: RankingYear,
    repositoryIds: readonly bigint[],
  ): Promise<readonly RankingCandidate[]> {
    const activity = await this.collection.getPublicRankingMetrics({
      repositoryIds,
      ...(year === RANKING_YEAR_ALL ? {} : { currentYear: year }),
    });

    return activity
      .map(({ githubId, githubLogin, commitCount, prCount, releaseCount }) => ({
        githubId,
        githubLogin,
        commitCount,
        prCount,
        releaseCount,
        total: commitCount + prCount + releaseCount,
      }))
      .filter((entry) => entry.total > 0);
  }

  private rankEntries(
    candidates: readonly RankingCandidate[],
  ): readonly RankingEntry[] {
    return [...candidates]
      .sort((left, right) => {
        const normalizedLoginOrder = left.githubLogin
          .normalize()
          .toLocaleLowerCase('en-US')
          .localeCompare(
            right.githubLogin.normalize().toLocaleLowerCase('en-US'),
            'en-US',
          );
        return (
          right.total - left.total ||
          right.commitCount - left.commitCount ||
          right.prCount - left.prCount ||
          right.releaseCount - left.releaseCount ||
          normalizedLoginOrder ||
          (left.githubId < right.githubId
            ? -1
            : left.githubId > right.githubId
              ? 1
              : 0)
        );
      })
      .map((entry, index) => ({
        rank: index + 1,
        displayName: entry.githubLogin,
        githubLogin: entry.githubLogin,
        commitCount: entry.commitCount,
        prCount: entry.prCount,
        releaseCount: entry.releaseCount,
        total: entry.total,
      }));
  }
}
