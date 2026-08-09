import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * `Contribution` 불변식 (ADR-010 §11).
 *
 * 검증의 최종 판정은 "학생이 자기 화면을 보고 맞다고 하는가"다. 그건 표본이고
 * 사람이 하는 일이다. 이 파일은 그 표본이 놓치는 것을 **전수로** 잡는다.
 *
 * 옛 DB 수치와 대조하지 않는다 — 규칙이 바뀌었으므로 비교 대상이 아니다.
 * 대신 새 데이터가 스스로 지켜야 하는 성질 넷을 검사한다.
 *
 * 넷 다 read-only 다. 고치지 않고 어긋난 사실만 보고한다 — 자동 교정은
 * 원인을 덮어버리고, 이 검사의 목적은 원인을 드러내는 것이다.
 */

/** 불변식 하나의 판정 결과. */
export interface ContributionInvariantResult {
  readonly name: string;
  readonly ok: boolean;
  /** 위반 건수. `ok`가 true면 0이다. */
  readonly violationCount: number;
  /** 사람이 읽는 설명. 저장소 이름·학생 식별자를 담지 않는다(공개 로그 경계). */
  readonly detail: string;
}

export interface ContributionInvariantReport {
  readonly checkedAt: Date;
  readonly ok: boolean;
  readonly results: readonly ContributionInvariantResult[];
}

@Injectable()
export class ContributionInvariants {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<ContributionInvariantReport> {
    const results = [
      await this.checkNoDuplicateGrain(),
      await this.checkOnlyEnrolledStudents(),
      await this.checkInternalSumConsistency(),
      await this.checkNoNegativeCounts(),
    ];
    return {
      checkedAt: new Date(),
      ok: results.every((result) => result.ok),
      results,
    };
  }

  /**
   * 불변식 1 — 입자 중복 0.
   *
   * `(repositoryId, githubId, date)` 가 기본키이므로 DB가 이미 막는다.
   * 그래도 검사하는 이유는, 이 성질이 깨졌다는 것은 곧 스키마가 우리가 아는 것과
   * 다르다는 뜻이고(수동 마이그레이션·복원 사고 등) 그건 다른 모든 판정의 전제가
   * 무너졌다는 신호이기 때문이다.
   */
  private async checkNoDuplicateGrain(): Promise<ContributionInvariantResult> {
    const grouped = await this.prisma.contribution.groupBy({
      by: ['repositoryId', 'githubId', 'date'],
      having: { githubId: { _count: { gt: 1 } } },
    });
    return {
      name: '입자 중복 0',
      ok: grouped.length === 0,
      violationCount: grouped.length,
      detail:
        grouped.length === 0
          ? '(repositoryId, githubId, date) 조합이 전부 유일하다'
          : `중복 조합 ${grouped.length}건 — 기본키가 우리가 아는 것과 다르다`,
    };
  }

  /**
   * 불변식 2 — 모든 `githubId` 가 가입자 집합에 속한다.
   *
   * 이게 깨지면 우리 플랫폼을 모르는 사람의 활동 프로필이 쌓이고 있다는 뜻이다(#682).
   * 표시에서 거르는 것으로는 부족하다 — 표시 규칙은 바뀌어도 쌓인 데이터는 남는다.
   */
  private async checkOnlyEnrolledStudents(): Promise<ContributionInvariantResult> {
    const distinct = await this.prisma.contribution.findMany({
      distinct: ['githubId'],
      select: { githubId: true },
    });
    if (distinct.length === 0) {
      return {
        name: '가입자만 적재',
        ok: true,
        violationCount: 0,
        detail: '기여 행이 없다',
      };
    }
    const githubIds = distinct.map((row) => row.githubId);
    const enrolled = await this.prisma.user.findMany({
      where: { githubId: { in: githubIds } },
      select: { githubId: true },
    });
    const enrolledSet = new Set(enrolled.map((user) => user.githubId));
    const strangers = githubIds.filter((id) => !enrolledSet.has(id));
    return {
      name: '가입자만 적재',
      ok: strangers.length === 0,
      violationCount: strangers.length,
      // 식별자를 담지 않는다 — 이 보고가 공개 로그로 갈 수 있다.
      detail:
        strangers.length === 0
          ? `기여자 ${githubIds.length}명이 모두 가입자다`
          : `가입자 아닌 기여자 ${strangers.length}명 — 적재 필터가 열려 있다`,
    };
  }

  /**
   * 불변식 3 — 저장소별 내부 합계 정합.
   *
   * `Contribution` 의 사람별 합계가 그 저장소 fact 테이블의 귀속 있는 건수와 같아야 한다.
   * 어긋나면 재계산이 일부만 돌았거나(부분 실패) 적재 필터가 fact 와 다른 기준을 쓰고 있다.
   *
   * fact 에는 귀속 없는 행도 있으므로 `authorGithubId IS NOT NULL` 로 맞춘다 —
   * 그게 `Contribution` 의 적재 기준이기 때문이다.
   */
  private async checkInternalSumConsistency(): Promise<ContributionInvariantResult> {
    const [contributionSums, commitCount, pullRequestCount, releaseCount] =
      await Promise.all([
        this.prisma.contribution.aggregate({
          _sum: {
            commitCount: true,
            pullRequestCount: true,
            releaseCount: true,
          },
        }),
        this.prisma.collectionCommitFact.count({
          where: { authorGithubId: { not: null } },
        }),
        this.prisma.collectionPullRequestFact.count({
          where: { authorGithubId: { not: null } },
        }),
        this.prisma.collectionReleaseFact.count({
          where: { authorGithubId: { not: null } },
        }),
      ]);

    // 가입자 필터 때문에 `Contribution` 쪽이 fact 보다 **작거나 같아야** 한다.
    // 크면 fact 없이 만들어진 행이 있다는 뜻이라 명백한 위반이다.
    const mismatches: string[] = [];
    const compare = (label: string, sum: number | null, factTotal: number) => {
      const value = sum ?? 0;
      if (value > factTotal) {
        mismatches.push(`${label} ${value} > fact ${factTotal}`);
      }
    };
    compare('commit', contributionSums._sum.commitCount, commitCount);
    compare('pr', contributionSums._sum.pullRequestCount, pullRequestCount);
    compare('release', contributionSums._sum.releaseCount, releaseCount);

    return {
      name: '내부 합계 정합',
      ok: mismatches.length === 0,
      violationCount: mismatches.length,
      detail:
        mismatches.length === 0
          ? '집계 합계가 fact 건수를 넘지 않는다'
          : `fact 보다 큰 집계: ${mismatches.join(', ')}`,
    };
  }

  /**
   * 불변식 4 — 음수 없음.
   *
   * 재실행 멱등성의 관측 가능한 대리다. 전량 재계산이 COUNT 로만 값을 만들므로
   * 음수는 원리상 나올 수 없고, 나왔다면 증분 누적 경로가 되살아났다는 뜻이다.
   * (같은 입력으로 두 번 돌려 같은 값이 나오는지는 통합 테스트가 직접 검증한다.)
   */
  private async checkNoNegativeCounts(): Promise<ContributionInvariantResult> {
    const negativeCount = await this.prisma.contribution.count({
      where: {
        OR: [
          { commitCount: { lt: 0 } },
          { pullRequestCount: { lt: 0 } },
          { releaseCount: { lt: 0 } },
        ],
      },
    });
    return {
      name: '음수 없음(멱등성 대리)',
      ok: negativeCount === 0,
      violationCount: negativeCount,
      detail:
        negativeCount === 0
          ? '모든 집계 값이 0 이상이다'
          : `음수 행 ${negativeCount}건 — 증분 누적 경로가 되살아났다`,
    };
  }
}
