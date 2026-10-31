import type { ActivityCounts } from '../../common/domain/activity-counts';
import {
  compareRankingCandidates,
  type RankingCandidate,
} from './ranking-order';

const TIED_TOTAL = 100;

function candidate(
  githubId: bigint,
  githubLogin: string,
  counts: Partial<ActivityCounts>,
  total = TIED_TOTAL,
): RankingCandidate {
  return {
    githubId,
    githubLogin,
    commitCount: counts.commitCount ?? 4,
    pullRequestCount: counts.pullRequestCount ?? 4,
    issueCount: counts.issueCount ?? 4,
    repositoryCount: counts.repositoryCount ?? 4,
    starCount: counts.starCount ?? 4,
    total,
  };
}

describe('compareRankingCandidates', () => {
  it('총점→커밋→PR→이슈→저장소→별→로그인→githubId 순으로 랭킹 표와 같게 줄 세운다', () => {
    const ordered = [
      candidate(1n, 'total', {}, TIED_TOTAL + 1),
      candidate(2n, 'commits', { commitCount: 5 }),
      candidate(3n, 'prs', { pullRequestCount: 5 }),
      candidate(4n, 'issues', { issueCount: 5 }),
      candidate(5n, 'repositories', { repositoryCount: 5 }),
      candidate(6n, 'stars', { starCount: 5 }),
      candidate(7n, 'alpha', {}),
      candidate(8n, 'Beta', {}),
      candidate(30n, 'dup', {}),
      candidate(31n, 'dup', {}),
    ];
    const identity = (entry: RankingCandidate) =>
      `${entry.githubLogin}#${entry.githubId.toString()}`;

    expect(
      [...ordered].reverse().sort(compareRankingCandidates).map(identity),
    ).toEqual(ordered.map(identity));
  });

  it('동일한 후보끼리는 0을 반환한다', () => {
    expect(
      compareRankingCandidates(
        candidate(5n, 'tie', { commitCount: 2 }),
        candidate(5n, 'tie', { commitCount: 2 }),
      ),
    ).toBe(0);
  });
});
