import { Inject, Injectable } from '@nestjs/common';
import {
  COLLECTION_READ_PORT,
  type CollectionReadPort,
} from '../../github/collection-read.port';
import { RankingViewerRepository } from '../repository/ranking-viewer.repository';
import {
  RANKING_VIEWER_TIERS,
  RANKING_YEAR_ALL,
  type RankingEntry,
  type RankingPage,
  type RankingViewerTier,
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
    private readonly viewers: RankingViewerRepository,
  ) {}

  /**
   * 세션 githubId 로 응답 계층을 정한다. 쿠키가 없거나 무효하면 `null` 이 오고,
   * 그때는 공개 계층이다 — 공개 endpoint 이므로 예외를 던지지 않는다.
   */
  async resolveViewerTier(githubId: bigint | null): Promise<RankingViewerTier> {
    return this.viewers.findTier(githubId);
  }

  async findPage(
    year: RankingYear,
    page: number,
    pageSize: number,
    tier: RankingViewerTier = RANKING_VIEWER_TIERS.PUBLIC,
  ): Promise<RankingPage> {
    // 수치와 수집 성공 시각은 서로 다른 의미라 각각 현재 DB 상태에서 읽는다.
    const [entries, dataAsOf] = await Promise.all([
      this.findEntries(year, tier),
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
    tier: RankingViewerTier,
  ): Promise<readonly RankingEntry[]> {
    // 계층을 키에 넣는다 — 비로그인 요청과 교직원 요청이 같은 in-flight 빌드를
    // 나눠 받으면 실명이 공개 응답으로 새거나 반대로 교직원이 실명을 못 받는다.
    const scopeKey =
      year === RANKING_YEAR_ALL ? RANKING_YEAR_ALL : `year:${year}`;
    const cacheKey = `${tier}:${scopeKey}`;
    const existingBuild = this.inFlightBuilds.get(cacheKey);
    if (existingBuild) return existingBuild;

    // 동시 요청만 한 번으로 합친다. 완료된 공개 결과는 보관하지 않아,
    // 외부 저장소가 PRIVATE/ABSENT로 회수된 다음 요청부터 즉시 제외된다.
    const build = this.buildEntries(year, tier).finally(() =>
      this.inFlightBuilds.delete(cacheKey),
    );
    this.inFlightBuilds.set(cacheKey, build);
    return build;
  }

  private async buildEntries(
    year: RankingYear,
    tier: RankingViewerTier,
  ): Promise<readonly RankingEntry[]> {
    const includeRealName = tier === RANKING_VIEWER_TIERS.STAFF;
    const activity = await this.collection.getPublicRankingMetrics({
      ...(year === RANKING_YEAR_ALL ? {} : { currentYear: year }),
      // 공개·학생 계층은 실명 컬럼을 아예 질의하지 않는다.
      ...(includeRealName ? { includeRealName: true } : {}),
    });

    // PM 확정 정책 — 가입한 모든 사용자가 공개 랭킹에 노출된다. 관측이 없으면
    // 5종 전부 0으로 표시한다(`total > 0` 필터는 여기서 걸지 않는다). 아래 정렬의
    // tiebreak(닉네임 → githubId)가 0점 동률까지 결정적 순서를 보장한다.
    const candidates = activity.map(
      ({
        githubId,
        githubLogin,
        department,
        realName,
        commitCount,
        pullRequestCount,
        issueCount,
        repositoryCount,
        starCount,
      }) => ({
        githubId,
        githubLogin,
        department,
        realName,
        commitCount,
        pullRequestCount,
        issueCount,
        repositoryCount,
        starCount,
        // 봉투 이름은 그대로 `total` — 5종의 단순 합이다.
        total:
          commitCount +
          pullRequestCount +
          issueCount +
          repositoryCount +
          starCount,
      }),
    );

    // 표기 정책은 계층을 따른다. 공개·학생 계층은 D3 그대로 GitHub nickname
    // 단일이고(실명을 질의하지도 않는다), 교직원·관리자만 `User.name` 을 본다 —
    // 그 계층에서도 실명이 비어 있으면 nickname 으로 내려앉는다.
    // **정렬은 계층과 무관하다** — 아래 tiebreak 는 지표·githubLogin·githubId 만 보며
    // displayName 을 보지 않는다. 누가 보든 같은 사람이 같은 등수다.
    return candidates
      .map((entry) => ({
        ...entry,
        rank: 0,
        displayName:
          (includeRealName ? (entry.realName ?? null) : null) ??
          entry.githubLogin,
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
          right.issueCount - left.issueCount ||
          right.repositoryCount - left.repositoryCount ||
          right.starCount - left.starCount ||
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
        department: entry.department,
        commitCount: entry.commitCount,
        pullRequestCount: entry.pullRequestCount,
        issueCount: entry.issueCount,
        repositoryCount: entry.repositoryCount,
        starCount: entry.starCount,
        total: entry.total,
      }));
  }
}
