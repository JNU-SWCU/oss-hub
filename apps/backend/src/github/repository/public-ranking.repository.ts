import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  COMPATIBLE_PROFILE_DEPARTMENT_SELECT,
  resolveCompatibleProfileDepartment,
} from '../../profiles/profile-compatibility';
import type {
  CollectionPublicRankingMetricsDto,
  CollectionPublicRankingMetricsQueryDto,
} from '../collection-read.port';

/**
 * 공개 랭킹 전용 query repository (`AGENTS.md` §4 · ADR-003).
 *
 * 랭킹 endpoint 에는 인증 가드가 없다. 그런데 읽는 대상인 `User` 는 private
 * 테이블이다 — 그 조합이 허용되는 경로는 **owner-approved dedicated public
 * query repository 안뿐**이며, 이 파일이 그 경로다.
 *
 * 그래서 여기서만 지키는 규칙이 셋 있다.
 *
 * 1. **명시적 `select` 만 쓴다.** `include` 나 무필터 조회를 하지 않는다.
 *    새 칸이 스키마에 생겨도 이 파일을 고치지 않는 한 밖으로 나가지 않는다.
 * 2. **DTO allowlist 밖의 값을 돌려주지 않는다.** 아래 `select` 는
 *    `CollectionPublicRankingMetricsDto` 가 선언한 것만 뽑는다.
 * 3. **실명(`User.name`)을 읽지 않는다.** 공개 표기는 `githubLogin` 단일이며,
 *    동의 철회 endpoint 가 없는 상태에서 실명 노출은 되돌릴 수 없다. 학과는
 *    `resolveCompatibleProfileDepartment` 로 읽는다 — `COMPATIBLE_PROFILE_SELECT`
 *    를 쓰면 실명이 같이 딸려 와 이 규칙이 깨진다.
 *
 * 수치의 출처는 **사람 축**(`GithubUserActivityHistory`)이다. 저장소 축
 * (`Contribution`)이 아니다 — 랭킹이 묻는 질문은 "이 사람이 올 한 해 얼마나
 * 활동했나"이지 "이 저장소에서 무슨 일이 있었나"가 아니다. 그래서 저장소
 * 가시성·소속 조건이 이 파일에 존재하지 않는다: 사람 축 관측은 GitHub GraphQL
 * 이 공개 활동만 돌려주는 값이라 이미 공개 범위로 닫혀 있다.
 */
@Injectable()
export class PublicRankingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PM 확정 정책 — 가입한 모든 사용자가 공개 랭킹에 노출된다. 활동 관측이
   * 없으면 5종 모두 0이다. 그래서 조회 시작점이 `GithubUserActivityHistory` 가
   * 아니라 `User` 다: 관측 행이 아직 없는 사용자는 이력만 훑어서는 결과에
   * 등장조차 못 한다. `User` ↔ `GithubUserActivityHistory` 는 FK 가 아니라
   * `githubId` 값 조인이라(테이블에 FK 를 두지 않는다 — data-modeling §3)
   * Prisma relation include 로 join 할 수 없다 — 그래서 둘을 각자 조회한 뒤
   * 애플리케이션에서 LEFT JOIN 한다.
   *
   * `currentYear` 를 주면 그 해 행만, 생략하면 전 연도를 접는다. 접을 때
   * commit·PR·issue·repo 는 더하고 **star 는 가장 최근 연도 관측값을 쓴다** —
   * star 는 그 시점 누적이라 연도별로 더하면 같은 별을 여러 번 세게 된다.
   */
  async findMetrics(
    query: CollectionPublicRankingMetricsQueryDto,
  ): Promise<readonly CollectionPublicRankingMetricsDto[]> {
    const [users, activityRows] = await Promise.all([
      // 가입한 모든 사용자 — 관측 유무와 무관하게 전원 포함한다.
      this.prisma.user.findMany({
        select: {
          githubId: true,
          nickname: true,
          ...COMPATIBLE_PROFILE_DEPARTMENT_SELECT,
        },
      }),
      this.prisma.githubUserActivityHistory.findMany({
        where:
          query.currentYear === undefined ? {} : { year: query.currentYear },
        // allowlist — 여기 없는 칸은 밖으로 나가지 않는다.
        select: {
          githubId: true,
          year: true,
          commitCount: true,
          pullRequestCount: true,
          issueCount: true,
          repositoryCount: true,
          starCount: true,
        },
      }),
    ]);

    const folded = new Map<
      string,
      {
        commitCount: number;
        pullRequestCount: number;
        issueCount: number;
        repositoryCount: number;
        starCount: number;
        starYear: number;
      }
    >();
    for (const row of activityRows) {
      const key = row.githubId.toString();
      const current = folded.get(key);
      if (current === undefined) {
        folded.set(key, {
          commitCount: row.commitCount,
          pullRequestCount: row.pullRequestCount,
          issueCount: row.issueCount,
          repositoryCount: row.repositoryCount,
          starCount: row.starCount,
          starYear: row.year,
        });
        continue;
      }
      current.commitCount += row.commitCount;
      current.pullRequestCount += row.pullRequestCount;
      current.issueCount += row.issueCount;
      current.repositoryCount += row.repositoryCount;
      if (row.year >= current.starYear) {
        current.starCount = row.starCount;
        current.starYear = row.year;
      }
    }

    // 표시할 이름이 없는 사용자는 제외한다.
    return users
      .filter((user) => user.nickname)
      .map((user) => {
        const totals = folded.get(user.githubId.toString());
        return {
          githubId: user.githubId,
          githubLogin: user.nickname,
          department: resolveCompatibleProfileDepartment(user),
          commitCount: totals?.commitCount ?? 0,
          pullRequestCount: totals?.pullRequestCount ?? 0,
          issueCount: totals?.issueCount ?? 0,
          repositoryCount: totals?.repositoryCount ?? 0,
          starCount: totals?.starCount ?? 0,
        };
      });
  }

  /** 사람 축 관측이 있는 연도 목록, 최신 순. */
  async listYears(): Promise<readonly number[]> {
    const rows = await this.prisma.githubUserActivityHistory.findMany({
      select: { year: true },
      distinct: ['year'],
    });
    return rows.map((row) => row.year).sort((left, right) => right - left);
  }

  /**
   * 공개 랭킹 수치의 기준 시각 (ADR-010 §10).
   *
   * **마지막 사람 축 관측 시각**이다. "마지막 데이터 변경 시각"이 아니다 —
   * 활동이 조용한 기간에는 값이 안 바뀌는 게 정상인데, 변경 시각을 보이면
   * 정상을 정지로 오인하게 만든다. 이 화면의 목적이 "멈추면 보인다"이므로
   * 멈춤 여부를 말해 주는 쪽을 쓴다.
   *
   * 목록과 따로 묻는다 — 목록 수치와 관측 시각은 서로 다른 의미이며,
   * 둘 다 요청 시점의 현재 공개 상태를 읽는다.
   */
  async findDataAsOf(): Promise<Date | null> {
    const latest = await this.prisma.githubUserActivityHistory.aggregate({
      _max: { observedAt: true },
    });
    return latest._max.observedAt ?? null;
  }
}
