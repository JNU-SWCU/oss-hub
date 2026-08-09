import { Inject, Injectable } from '@nestjs/common';
import {
  COLLECTION_READ_PORT,
  type CollectionReadPort,
} from '../../github/collection-read.port';
import { UserDisplayNameRepository } from '../../users/user-display-name.repository';
import {
  RANKING_YEAR_ALL,
  type RankingEntry,
  type RankingPage,
  type RankingYear,
} from '../domain/ranking';

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
    private readonly displayNames: UserDisplayNameRepository,
  ) {}

  async findPage(
    year: RankingYear,
    page: number,
    pageSize: number,
  ): Promise<RankingPage> {
    // 갱신 시각은 목록 캐시 **밖에서** 따로 묻는다(ADR-010 §10).
    // 같이 캐시되면 수집이 멈춰도 시각이 60초마다 새로워지는 것처럼 보인다.
    const [entries, dataAsOf] = await Promise.all([
      this.findEntries(year),
      this.collection.getPublicRankingDataAsOf(),
    ]);
    const start = (page - 1) * pageSize;
    return {
      year,
      items: entries.slice(start, start + pageSize),
      page,
      pageSize,
      total: entries.length,
      dataAsOf,
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
      .map(({ githubId, githubLogin, commitCount, pullRequestCount, releaseCount }) => ({
        githubId,
        githubLogin,
        commitCount,
        pullRequestCount,
        releaseCount,
        total: commitCount + pullRequestCount + releaseCount,
      }))
      .filter((entry) => entry.total > 0);

    // 정책 결정 D3(.omc/plans/student-repo-ranking-tracking.md §1 "확정된 정책" 표,
    // `:41`) — 비인증 공개 /ranking 응답의 공개 표기는 GitHub nickname으로
    // 단일화한다. `d7bfc566`가 실명을 우선 노출하도록 바꿨던 것은 이 정책 위반이라
    // 되돌린다 — displayName은 항상 githubLogin이다. `findDisplayNames`(아래)는 이
    // 되돌림으로 더는 호출되지 않지만, `UserDisplayNameRepository`를 완전히
    // 제거할지는 별도 판단이 필요해 이번 변경 범위 밖으로 남겨 둔다.
    return candidates
      .map((entry) => ({
        ...entry,
        rank: 0,
        displayName: entry.githubLogin,
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
          right.pullRequestCount - left.pullRequestCount ||
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
        pullRequestCount: entry.pullRequestCount,
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
