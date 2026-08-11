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

@Injectable()
export class RankingService {
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
    // 수치와 수집 성공 시각은 서로 다른 의미라 각각 현재 DB 상태에서 읽는다.
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
    const existingBuild = this.inFlightBuilds.get(cacheKey);
    if (existingBuild) return existingBuild;

    // 동시 요청만 한 번으로 합친다. 완료된 공개 결과는 보관하지 않아,
    // 외부 저장소가 PRIVATE/ABSENT로 회수된 다음 요청부터 즉시 제외된다.
    const build = this.buildEntries(year).finally(() =>
      this.inFlightBuilds.delete(cacheKey),
    );
    this.inFlightBuilds.set(cacheKey, build);
    return build;
  }

  private async buildEntries(
    year: RankingYear,
  ): Promise<readonly RankingEntry[]> {
    const activity = await this.collection.getPublicRankingMetrics(
      year === RANKING_YEAR_ALL ? {} : { currentYear: year },
    );

    // PM 확정 정책 — 가입한 모든 사용자가 공개 랭킹에 노출된다. 기여가 없으면
    // 0/0/0으로 표시한다(`total > 0` 필터는 여기서 걸지 않는다). 아래 정렬의
    // tiebreak(닉네임 → githubId)가 0점 동률까지 결정적 순서를 보장한다.
    const candidates = activity.map(
      ({
        githubId,
        githubLogin,
        commitCount,
        pullRequestCount,
        releaseCount,
      }) => ({
        githubId,
        githubLogin,
        commitCount,
        pullRequestCount,
        releaseCount,
        total: commitCount + pullRequestCount + releaseCount,
      }),
    );

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
