import { Inject, Injectable } from '@nestjs/common';
import {
  COLLECTION_READ_PORT,
  type CollectionReadPort,
} from '../collection/collection-read.port';
import { UserDisplayNameStore } from '../users/user-display-name.store';
import {
  RANKING_YEAR_ALL,
  type RankingEntry,
  type RankingPage,
  type RankingYear,
} from './domain/ranking';

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
    @Inject(COLLECTION_READ_PORT)
    private readonly collection: CollectionReadPort,
    private readonly displayNames: UserDisplayNameStore,
  ) {}

  async findPage(
    year: RankingYear,
    page: number,
    pageSize: number,
  ): Promise<RankingPage> {
    const entries = await this.findEntries(year);
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

  private async findEntries(
    year: RankingYear,
  ): Promise<readonly RankingEntry[]> {
    const cacheKey =
      year === RANKING_YEAR_ALL ? RANKING_YEAR_ALL : `year:${year}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.entries;

    const existingBuild = this.inFlightBuilds.get(cacheKey);
    if (existingBuild) return existingBuild;

    const build = this.buildEntries(year)
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
    year: RankingYear,
  ): Promise<readonly RankingEntry[]> {
    const activity = await this.collection.getPublicRankingMetrics(
      year === RANKING_YEAR_ALL ? {} : { currentYear: year },
    );

    const candidates = activity
      .map(({ githubId, githubLogin, commitCount, prCount, releaseCount }) => ({
        githubId,
        githubLogin,
        commitCount,
        prCount,
        releaseCount,
        total: commitCount + prCount + releaseCount,
      }))
      .filter((entry) => entry.total > 0);

    // 이름 조회는 60초 캐시로 감싸인 buildEntries 안에서 이뤄진다 — 랭킹 목록과 같은
    // staleness를 허용하는 대신, 캐시가 살아있는 동안은 추가 질의 없이 재사용된다.
    const names = await this.findDisplayNames(
      candidates.map((entry) => entry.githubId),
    );

    return candidates
      .map((entry) => ({
        ...entry,
        rank: 0,
        displayName: names.get(entry.githubId)?.trim() || entry.githubLogin,
      }))
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
        displayName: entry.displayName,
        githubLogin: entry.githubLogin,
        commitCount: entry.commitCount,
        prCount: entry.prCount,
        releaseCount: entry.releaseCount,
        total: entry.total,
      }));
  }

  private async findDisplayNames(
    githubIds: readonly bigint[],
  ): Promise<ReadonlyMap<bigint, string | null>> {
    const uniqueIds = [...new Set(githubIds)];
    const users = await this.displayNames.findByGithubIds(uniqueIds);
    return new Map(users.map((user) => [user.githubId, user.name]));
  }
}
