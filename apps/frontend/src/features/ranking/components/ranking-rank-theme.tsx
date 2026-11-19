import type { PublicRankingItem } from '../types';
import {
  RankingStreakDecoration,
  type RankingStreakTier,
} from './ranking-streak-decoration';

const ACCESSIBLE_TIER_NAMES = [
  '금빛 날개관',
  '남빛 삼봉관',
  '초록 깃관',
  '붉은 인장관',
  '청록 날개모',
  '주황 띠관',
  '보라 쌍귀관',
  '자주 첨두관',
  '올리브 갈래관',
  '남빛 구슬관',
] as const;

function tierFor(days: number): RankingStreakTier {
  if (days >= 100) return 'celebration';
  if (days >= 30) return 'strong';
  if (days >= 7) return 'shimmer';
  return 'plain';
}

export function RankingRankMember({
  item,
}: {
  readonly item: PublicRankingItem;
}) {
  const href = `https://github.com/${item.githubLogin}`;
  const linkAriaLabel = `${item.githubLogin}의 GitHub 프로필 (새 탭에서 열림)`;
  const accessibleTierName = ACCESSIBLE_TIER_NAMES[item.rank - 1];
  if (
    accessibleTierName === undefined ||
    item.streak === undefined ||
    item.streak === null
  ) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={linkAriaLabel}
        className="break-keep whitespace-normal hover:underline"
      >
        {item.githubLogin}
      </a>
    );
  }
  const rankHeld = item.rank === 1;
  const days = rankHeld ? item.streak.rankHeldDays : item.streak.top10Days;
  return (
    <RankingStreakDecoration
      rank={item.rank}
      accessibleTierName={accessibleTierName}
      days={days}
      tenureLabel={rankHeld ? '1위' : 'TOP 10'}
      tier={tierFor(days)}
      name={item.githubLogin}
      href={href}
      linkAriaLabel={linkAriaLabel}
    />
  );
}
