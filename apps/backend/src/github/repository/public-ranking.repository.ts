import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import type { RepositorySource } from '../collection-incremental.types';
import type {
  CollectionPublicRankingMetricsDto,
  CollectionPublicRankingMetricsQueryDto,
} from '../collection-read.port';

/**
 * 공개 랭킹 전용 query repository (`AGENTS.md` §4 · ADR-003).
 *
 * 랭킹 endpoint 에는 인증 가드가 없다. 그런데 읽는 대상인 `User`/`Contribution` 은
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
 * 저장소 범위(`RANKING_REPOSITORY_SCOPE`)도 여기서만 건다. 호출자가 넘기는
 * 값으로 이 조건을 바꿀 수 없다 — 인자에 없기 때문이다.
 *
 * PM 확정 정책(2026-08) — 저장소는 PRIVATE 으로 생성되고 4중 게이트 + staff
 * 수동 publish 를 거쳐야 PUBLIC 이 되므로, `visibility: 'PUBLIC'` 만 세면 실제
 * 기여자 대부분이 랭킹에서 사라진다. 그래서 이 필터에는 더 이상 `visibility`가
 * 없다 — org 저장소(`ORG_PROVISIONED`)와 학생이 등록한 조직 밖 public 저장소
 * (`EXTERNAL_PUBLIC`) 모두, `presence`가 `PRESENT`인 한 포함한다. 저장소
 * 이름/visibility 자체는 이 파일 밖으로 select 되지 않으므로, PRIVATE 저장소
 * 활동을 합산해도 응답에 저장소 식별자가 새어나가지 않는다.
 */
@Injectable()
export class PublicRankingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 집계 대상 저장소 범위. 이 조건은 호출자가 바꿀 수 없다. */
  private static readonly RANKING_REPOSITORY_SCOPE: {
    readonly source: { readonly in: RepositorySource[] };
    readonly presence: 'PRESENT';
  } = {
    source: { in: ['ORG_PROVISIONED', 'EXTERNAL_PUBLIC'] },
    presence: 'PRESENT',
  };

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

  /**
   * PM 확정 정책 — 가입한 모든 사용자가 공개 랭킹에 노출된다. 기여가 없으면
   * 0/0/0 이다. 그래서 조회 시작점이 `Contribution` 이 아니라 `User` 다: 기여
   * 행이 하나도 없는 사용자는 `Contribution` 만 훑어서는 결과에 등장조차 못
   * 한다. `User`↔`Contribution` 은 FK 가 아니라 `githubId` 값 조인이라
   * (`Contribution.githubId` 에 스키마 comment 참고) Prisma relation include
   * 로 join 할 수 없다 — 그래서 둘을 각자 조회한 뒤 애플리케이션에서 LEFT
   * JOIN 한다.
   */
  async findMetrics(
    query: CollectionPublicRankingMetricsQueryDto,
  ): Promise<readonly CollectionPublicRankingMetricsDto[]> {
    const bounds =
      query.currentYear === undefined
        ? undefined
        : PublicRankingRepository.yearBounds(query.currentYear);

    const [users, contributionRows] = await Promise.all([
      // 가입한 모든 사용자 — 기여 유무와 무관하게 전원 포함한다.
      this.prisma.user.findMany({
        select: { githubId: true, nickname: true },
      }),
      this.prisma.contribution.findMany({
        where: {
          repository: PublicRankingRepository.RANKING_REPOSITORY_SCOPE,
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
      }),
    ]);

    const folded = new Map<
      string,
      { commitCount: number; pullRequestCount: number; releaseCount: number }
    >();
    for (const row of contributionRows) {
      const key = row.githubId.toString();
      const current = folded.get(key);
      if (current === undefined) {
        folded.set(key, {
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

    // 표시할 이름이 없는 사용자는 제외한다.
    return users
      .filter((user) => user.nickname)
      .map((user) => {
        const totals = folded.get(user.githubId.toString());
        return {
          githubId: user.githubId,
          githubLogin: user.nickname,
          commitCount: totals?.commitCount ?? 0,
          pullRequestCount: totals?.pullRequestCount ?? 0,
          releaseCount: totals?.releaseCount ?? 0,
        };
      });
  }

  /** 공개 랭킹 활동이 있는 연도 목록, 최신 순. */
  async listYears(): Promise<readonly number[]> {
    const rows = await this.prisma.contribution.findMany({
      where: {
        repository: PublicRankingRepository.RANKING_REPOSITORY_SCOPE,
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
   * 목록과 따로 묻는다 — 목록 수치와 수집 성공 시각은 서로 다른 의미이며,
   * 둘 다 요청 시점의 현재 공개 상태를 읽는다.
   */
  async findDataAsOf(): Promise<Date | null> {
    const latest = await this.prisma.githubRepository.aggregate({
      where: PublicRankingRepository.RANKING_REPOSITORY_SCOPE,
      _max: { lastSuccessAt: true },
    });
    return latest._max.lastSuccessAt ?? null;
  }
}
