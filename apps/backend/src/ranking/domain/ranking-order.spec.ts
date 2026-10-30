import {
  activityTotal,
  type ActivityCounts,
} from '../../common/domain/activity-counts';
import {
  compareRankingCandidates,
  type RankingCandidate,
} from './ranking-order';

function candidate(
  githubId: bigint,
  githubLogin: string,
  counts: Partial<ActivityCounts> = {},
  total?: number,
): RankingCandidate {
  const metrics: ActivityCounts = {
    commitCount: counts.commitCount ?? 0,
    pullRequestCount: counts.pullRequestCount ?? 0,
    issueCount: counts.issueCount ?? 0,
    repositoryCount: counts.repositoryCount ?? 0,
    starCount: counts.starCount ?? 0,
  };
  return {
    githubId,
    githubLogin,
    ...metrics,
    total: total ?? activityTotal(metrics),
  };
}

function order(candidates: readonly RankingCandidate[]): readonly string[] {
  return [...candidates]
    .sort(compareRankingCandidates)
    .map((entry) => entry.githubLogin);
}

describe('compareRankingCandidates', () => {
  it('총점이 높은 후보를 지표별 열세와 무관하게 앞에 둔다', () => {
    expect(
      order([
        candidate(1n, 'low', { commitCount: 4 }),
        candidate(2n, 'high', { starCount: 5 }),
      ]),
    ).toEqual(['high', 'low']);
  });

  it('총점이 같으면 커밋 수가 많은 쪽이 앞선다', () => {
    expect(
      order([
        candidate(1n, 'fewer-commits', { commitCount: 1, issueCount: 2 }),
        candidate(2n, 'more-commits', { commitCount: 3 }),
      ]),
    ).toEqual(['more-commits', 'fewer-commits']);
  });

  it('총점과 커밋 수가 같으면 PR 수가 많은 쪽이 앞선다', () => {
    expect(
      order([
        candidate(1n, 'fewer-prs', { commitCount: 3, issueCount: 2 }),
        candidate(2n, 'more-prs', { commitCount: 3, pullRequestCount: 2 }),
      ]),
    ).toEqual(['more-prs', 'fewer-prs']);
  });

  it('총점, 커밋, PR 수가 같으면 이슈 수가 많은 쪽이 앞선다', () => {
    expect(
      order([
        candidate(1n, 'fewer-issues', {
          commitCount: 3,
          pullRequestCount: 2,
          repositoryCount: 2,
        }),
        candidate(2n, 'more-issues', {
          commitCount: 3,
          pullRequestCount: 2,
          issueCount: 2,
        }),
      ]),
    ).toEqual(['more-issues', 'fewer-issues']);
  });

  it('총점, 커밋, PR, 이슈 수가 같으면 저장소 수가 많은 쪽이 앞선다', () => {
    expect(
      order([
        candidate(1n, 'fewer-repositories', {
          commitCount: 3,
          pullRequestCount: 2,
          issueCount: 1,
          starCount: 2,
        }),
        candidate(2n, 'more-repositories', {
          commitCount: 3,
          pullRequestCount: 2,
          issueCount: 1,
          repositoryCount: 2,
        }),
      ]),
    ).toEqual(['more-repositories', 'fewer-repositories']);
  });

  it('총점과 나머지 지표가 같게 주어지면 별 수가 많은 쪽이 앞선다', () => {
    expect(
      order([
        candidate(1n, 'fewer-stars', { starCount: 1 }, 5),
        candidate(2n, 'more-stars', { starCount: 3 }, 5),
      ]),
    ).toEqual(['more-stars', 'fewer-stars']);
  });

  it('모든 지표가 같으면 대소문자를 무시한 로그인 순서로 정렬한다', () => {
    expect(
      order([
        candidate(1n, 'Zeta', { commitCount: 2 }),
        candidate(2n, 'alpha', { commitCount: 2 }),
        candidate(3n, 'Mike', { commitCount: 2 }),
      ]),
    ).toEqual(['alpha', 'Mike', 'Zeta']);
  });

  it('대소문자만 다른 로그인은 GitHub id 오름차순으로 떨어진다', () => {
    expect(
      order([
        candidate(10n, 'Same', { commitCount: 3 }),
        candidate(2n, 'same', { commitCount: 3 }),
        candidate(7n, 'SAME', { commitCount: 3 }),
      ]),
    ).toEqual(['same', 'SAME', 'Same']);
  });

  it('로그인까지 같으면 GitHub id 오름차순으로 정렬한다', () => {
    expect(
      [
        candidate(30n, 'dup', { commitCount: 1 }),
        candidate(4n, 'dup', { commitCount: 1 }),
      ]
        .sort(compareRankingCandidates)
        .map((entry) => entry.githubId),
    ).toEqual([4n, 30n]);
  });

  it('동일한 후보끼리는 0을 반환한다', () => {
    const left = candidate(5n, 'tie', { commitCount: 2, starCount: 1 });
    const right = candidate(5n, 'tie', { commitCount: 2, starCount: 1 });
    expect(compareRankingCandidates(left, right)).toBe(0);
  });

  it('모든 단계를 함께 적용한 순서가 랭킹 표의 순서와 같다', () => {
    expect(
      order([
        candidate(20n, 'z', {
          commitCount: 2,
          pullRequestCount: 1,
          issueCount: 1,
        }),
        candidate(21n, 'a', {
          commitCount: 3,
          pullRequestCount: 0,
          issueCount: 1,
        }),
        candidate(22n, 'b', {
          commitCount: 3,
          pullRequestCount: 1,
          issueCount: 0,
        }),
        candidate(23n, 'c', {
          commitCount: 3,
          pullRequestCount: 1,
          issueCount: 1,
        }),
        candidate(10n, 'Same', {
          commitCount: 3,
          pullRequestCount: 1,
          issueCount: 1,
        }),
        candidate(2n, 'same', {
          commitCount: 3,
          pullRequestCount: 1,
          issueCount: 1,
        }),
        candidate(30n, 'top', { commitCount: 6 }),
      ]),
    ).toEqual(['top', 'c', 'same', 'Same', 'b', 'a', 'z']);
  });
});
