import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

export interface ContributionInvariantResult {
  readonly name: string;
  readonly ok: boolean;

  readonly violationCount: number;

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

      detail:
        strangers.length === 0
          ? `기여자 ${githubIds.length}명이 모두 가입자다`
          : `가입자 아닌 기여자 ${strangers.length}명 — 적재 필터가 열려 있다`,
    };
  }

  private async checkInternalSumConsistency(): Promise<ContributionInvariantResult> {
    const [
      contributionSums,
      commitCount,
      pullRequestCount,
      releaseCount,
      issueCount,
    ] = await Promise.all([
      this.prisma.contribution.aggregate({
        _sum: {
          commitCount: true,
          pullRequestCount: true,
          releaseCount: true,
          issueCount: true,
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
      this.prisma.githubIssueHistory.count({
        where: { authorGithubId: { not: null } },
      }),
    ]);

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
    compare('issue', contributionSums._sum.issueCount, issueCount);

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

  private async checkNoNegativeCounts(): Promise<ContributionInvariantResult> {
    const negativeCount = await this.prisma.contribution.count({
      where: {
        OR: [
          { commitCount: { lt: 0 } },
          { pullRequestCount: { lt: 0 } },
          { releaseCount: { lt: 0 } },
          { issueCount: { lt: 0 } },
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
