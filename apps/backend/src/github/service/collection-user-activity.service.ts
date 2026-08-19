import { Injectable, Logger } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CollectionDiscoveryClient,
  CollectionDiscoveryClientError,
} from '../collection-discovery.client';

/** Asia/Seoul(UTC+9, DST 없음) 오프셋 — 연도 경계를 자르는 유일한 기준이다. */
const ASIA_SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 사람 축(person-axis) 활동 수집 sweep.
 *
 * 가입(`accountStatus: ACTIVE`)한 `User` 전원을 순회하며 GitHub GraphQL에
 * "이 사람이 그 해에 얼마나 활동했나"를 직접 물어 `GithubUserActivityHistory`의
 * `(githubId, year)` 행으로 전량 재계산 upsert한다. 저장소 축(`Contribution`)에는
 * 아무것도 쓰지 않는다 — 두 축은 키가 달라 물리적으로 섞일 수 없다
 * (`docs/rules/data-modeling.md` §2).
 *
 * **성장 경로 — staleness 우선순위 드레인(지금은 구현하지 않는다)**: 이번 배치는 매 tick **전원 순회(full sweep)**로
 * 고정한다. 실측 51명(ACTIVE) × 연도당 GraphQL cost 1이면 매시 tick이 5,000/h 예산의
 * 1% 미만이라 우선순위 큐가 아직 이득이 없다(YAGNI). 전원 순회가 예산·시간을 넘기면
 * `GithubUserActivityHistory`의 observedAt 오름차순(= 가장 오래된 관측부터)으로 배치 N명씩 꺼내 도는 방식으로
 * 바꾼다 — 이는 저장소 축이 이미 쓰는 `nextRunAt` 굶주림(starvation) 순서 큐와 같은
 * 패턴이다(`collection-incremental.repository.ts:438,456,474`의 `nextRunAt`+`failureCount`
 * 지수 백오프, drain 조건 `collection-read.service.ts:645`). 전환 트리거는 둘 중 하나다:
 * (1) 한 tick이 cron 주기(`COLLECTION_CRON_EXPRESSION`)를 초과한다,
 * (2) rate limit `remaining`이 예산의 20% 미만으로 떨어진다.
 * 그때 `observedAt` 인덱스를 함께 추가한다 — 지금 미리 넣지 않는다.
 */
export interface CollectionUserActivitySweepResult {
  /** 이번 sweep이 순회한 ACTIVE 유저 수. */
  readonly observedUserCount: number;
  /** 실제로 GraphQL을 호출해 upsert에 성공한 (유저, 연도) 관측 수. */
  readonly upsertedRowCount: number;
  /** 이미 행이 있어 재조회하지 않은 과거 연도 수. */
  readonly skippedPastYearCount: number;
  /** 실패한 유저 수 — 한 명 실패가 sweep을 세우지 않는다. */
  readonly failedUserCount: number;
}

interface ActivityTarget {
  readonly githubId: bigint;
  readonly nickname: string;
}

/**
 * `contributionsCollection`은 1년을 넘는 창을 하드 `VALIDATION` 오류로 거부한다
 * (`collection-discovery.client.ts`). 그래서 연도 창은 언제나 **한 해 안**이며,
 * 올해는 "올해 1/1 00:00 KST ~ 지금"으로 잘라 그 상한을 구조적으로 넘길 수 없게 한다.
 */
const seoulYearStart = (year: number): Date =>
  new Date(Date.UTC(year, 0, 1) - ASIA_SEOUL_OFFSET_MS);

const seoulYearOf = (instant: Date): number =>
  new Date(instant.getTime() + ASIA_SEOUL_OFFSET_MS).getUTCFullYear();

@Injectable()
export class CollectionUserActivityService {
  private readonly logger = new Logger(CollectionUserActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discoveryClient: CollectionDiscoveryClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * 대상 연도들(기본: 올해 하나)에 대해 ACTIVE 유저 전원을 순회한다.
   *
   * 올해 행은 매 실행 갱신하고, 과거 연도는 행이 이미 있으면 GraphQL을 부르지
   * 않는다 — 지난 해의 활동은 더 이상 변하지 않으므로 재조회가 순수 낭비다.
   */
  async run(years?: readonly number[]): Promise<CollectionUserActivitySweepResult> {
    const startedAt = this.now();
    const currentYear = seoulYearOf(startedAt);
    const targetYears = years === undefined ? [currentYear] : [...years];

    const users = await this.prisma.user.findMany({
      where: { accountStatus: AccountStatus.ACTIVE },
      select: { githubId: true, nickname: true },
      orderBy: { githubId: 'asc' },
    });

    let upsertedRowCount = 0;
    let skippedPastYearCount = 0;
    let failedUserCount = 0;

    for (const user of users) {
      let userFailed = false;
      for (const year of targetYears) {
        if (year !== currentYear && (await this.hasObservation(user, year))) {
          skippedPastYearCount += 1;
          continue;
        }
        // 학생 단위 실패 격리 — 한 명이 실패해도 남은 사람을 계속 돈다
        // (ADR-010 §6과 같은 원칙: 실패는 sweep을 세우지 않는다).
        try {
          await this.observe(user, year, currentYear, startedAt);
          upsertedRowCount += 1;
        } catch (error) {
          userFailed = true;
          // discovery client 오류는 kind만 갖고 PAT 원문·저장소 이름을 담지
          // 않는다 — 분류만 남기고 식별자는 남기지 않는다.
          this.logger.warn({
            event: 'collection.user_activity.user_failed',
            year,
            kind:
              error instanceof CollectionDiscoveryClientError
                ? error.kind
                : 'UNKNOWN',
          });
        }
      }
      if (userFailed) failedUserCount += 1;
    }

    return {
      observedUserCount: users.length,
      upsertedRowCount,
      skippedPastYearCount,
      failedUserCount,
    };
  }

  private async hasObservation(
    user: ActivityTarget,
    year: number,
  ): Promise<boolean> {
    const existing = await this.prisma.githubUserActivityHistory.findUnique({
      where: { githubId_year: { githubId: user.githubId, year } },
      select: { githubId: true },
    });
    return existing !== null;
  }

  private async observe(
    user: ActivityTarget,
    year: number,
    currentYear: number,
    startedAt: Date,
  ): Promise<void> {
    const from = seoulYearStart(year);
    // 올해는 "지금"까지, 지난 해는 그 해 마지막 순간까지 — 어느 쪽도 1년을
    // 넘지 않으므로 `contributionsCollection`의 하드 상한을 건드리지 않는다.
    const to = year === currentYear ? startedAt : seoulYearStart(year + 1);

    const metrics = await this.discoveryClient.fetchUserActivityMetrics(
      user.nickname,
      from.toISOString(),
      to.toISOString(),
    );

    const observedAt = this.now();
    // 전량 재계산 upsert — 관측값이 곧 행 전체다(누적 가산이 아니다).
    const row = {
      githubLogin: user.nickname,
      commitCount: metrics.commitCount,
      pullRequestCount: metrics.pullRequestCount,
      issueCount: metrics.issueCount,
      repositoryCount: metrics.repositoryCount,
      starCount: metrics.starCount,
      observedAt,
    };
    await this.prisma.githubUserActivityHistory.upsert({
      where: { githubId_year: { githubId: user.githubId, year } },
      create: { githubId: user.githubId, year, ...row },
      update: row,
    });
  }
}
