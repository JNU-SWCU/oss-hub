import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import type {
  CollectionPublicRankingMetricsDto,
  CollectionPublicRankingMetricsQueryDto,
} from '../collection-read.port';

/**
 * 공개 랭킹 전용 query repository (`AGENTS.md` §4 · ADR-003).
 *
 * 랭킹 endpoint 에는 인증 가드가 없다. 그런데 읽는 대상인 `Contribution` 은
 * private 테이블이다 — 그 조합이 허용되는 경로는 **owner-approved dedicated
 * public query repository 안뿐**이며, 이 파일이 그 경로다.
 *
 * 그래서 여기서만 지키는 규칙이 셋 있다.
 *
 * 1. **명시적 `select` 만 쓴다.** `include` 나 무필터 조회를 하지 않는다.
 *    새 칸이 스키마에 생겨도 이 파일을 고치지 않는 한 밖으로 나가지 않는다.
 * 2. **DTO allowlist 밖의 값을 돌려주지 않는다.** 아래 `select` 는
 *    `CollectionPublicRankingMetricsDto` 가 선언한 것만 뽑는다.
 * 3. **실명(`User.name`)을 읽지 않는다.** 공개 표기는 `githubLogin` 단일이며,
 *    동의 철회 endpoint 가 없는 상태에서 실명 노출은 되돌릴 수 없다.
 *
 * 저장소 필터(`visibility: 'PUBLIC'` + `presence: 'PRESENT'`)도 여기서만 건다.
 * 호출자가 넘기는 값으로 이 조건을 바꿀 수 없다 — 인자에 없기 때문이다.
 */
@Injectable()
export class PublicRankingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 공개 저장소만. 이 조건은 호출자가 바꿀 수 없다. */
  private static readonly PUBLIC_REPOSITORY = {
    visibility: 'PUBLIC',
    presence: 'PRESENT',
  } as const;

  /**
   * Asia/Seoul 달력 연도의 `[start, end)` UTC 경계.
   *
   * `Contribution` 에는 `year` 칸이 없다(ADR-010 §4) — 저장에 연도 개념을 두지 않고
   * 읽을 때 범위로만 자르므로 새해 롤오버 작업이 없다.
   */
  private static yearBounds(year: number): readonly [Date, Date] {
    return [
      new Date(Date.UTC(year, 0, 1) - 9 * 60 * 60 * 1000),
      new Date(Date.UTC(year + 1, 0, 1) - 9 * 60 * 60 * 1000),
    ];
  }

  async findMetrics(
    query: CollectionPublicRankingMetricsQueryDto,
  ): Promise<readonly CollectionPublicRankingMetricsDto[]> {
    const bounds =
      query.currentYear === undefined
        ? undefined
        : PublicRankingRepository.yearBounds(query.currentYear);

    const rows = await this.prisma.contribution.findMany({
      where: {
        repository: PublicRankingRepository.PUBLIC_REPOSITORY,
        ...(bounds === undefined
          ? {}
          : { date: { gte: bounds[0], lt: bounds[1] } }),
      },
      // allowlist — 여기 없는 칸은 밖으로 나가지 않는다.
      select: {
        githubId: true,
        commitCount: true,
        pullRequestCount: true,
        releaseCount: true,
      },
    });

    const folded = new Map<
      string,
      {
        githubId: bigint;
        commitCount: number;
        pullRequestCount: number;
        releaseCount: number;
      }
    >();
    for (const row of rows) {
      const key = row.githubId.toString();
      const current = folded.get(key);
      if (current === undefined) {
        folded.set(key, {
          githubId: row.githubId,
          commitCount: row.commitCount,
          pullRequestCount: row.pullRequestCount,
          releaseCount: row.releaseCount,
        });
        continue;
      }
      current.commitCount += row.commitCount;
      current.pullRequestCount += row.pullRequestCount;
      current.releaseCount += row.releaseCount;
    }

    const logins = await this.resolveLogins(
      [...folded.values()].map((entry) => entry.githubId),
    );

    return [...folded.values()].map((entry) => ({
      githubId: entry.githubId,
      githubLogin: logins.get(entry.githubId) ?? '',
      commitCount: entry.commitCount,
      pullRequestCount: entry.pullRequestCount,
      releaseCount: entry.releaseCount,
    }));
  }

  /** 공개 랭킹 활동이 있는 연도 목록, 최신 순. */
  async listYears(): Promise<readonly number[]> {
    const rows = await this.prisma.contribution.findMany({
      where: {
        repository: PublicRankingRepository.PUBLIC_REPOSITORY,
        OR: [
          { commitCount: { gt: 0 } },
          { pullRequestCount: { gt: 0 } },
          { releaseCount: { gt: 0 } },
        ],
      },
      select: { date: true },
    });
    // `date` 는 Asia/Seoul 자정을 UTC 로 담고 있다.
    const years = new Set(
      rows.map((row) =>
        new Date(row.date.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear(),
      ),
    );
    return [...years].sort((left, right) => right - left);
  }

  /**
   * 공개 랭킹 수치의 기준 시각 (ADR-010 §10).
   *
   * **마지막 수집 성공 시각**이다. "마지막 데이터 변경 시각"이 아니다 —
   * 활동이 조용한 기간에는 값이 안 바뀌는 게 정상인데, 변경 시각을 보이면
   * 정상을 정지로 오인하게 만든다. 이 화면의 목적이 "멈추면 보인다"이므로
   * 멈춤 여부를 말해 주는 쪽을 쓴다.
   *
   * 목록과 따로 묻는다 — 목록은 60초 캐시를 타는데 시각까지 캐시되면
   * 수집이 멈춰도 화면은 계속 최신인 것처럼 보인다.
   */
  async findDataAsOf(): Promise<Date | null> {
    const latest = await this.prisma.githubRepository.aggregate({
      where: PublicRankingRepository.PUBLIC_REPOSITORY,
      _max: { lastSuccessAt: true },
    });
    return latest._max.lastSuccessAt ?? null;
  }

  /**
   * `githubId` → GitHub login.
   *
   * `nickname` 만 읽는다. `name`(실명)은 select 에 넣지 않는다 —
   * 이 값이 인증 없는 공개 응답으로 그대로 나간다.
   */
  private async resolveLogins(
    githubIds: readonly bigint[],
  ): Promise<ReadonlyMap<bigint, string>> {
    const unique = [...new Set(githubIds)];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { githubId: { in: unique } },
      select: { githubId: true, nickname: true },
    });
    return new Map(users.map((user) => [user.githubId, user.nickname]));
  }
}
