import type { ReactNode } from 'react';
import type { PublicRankingItem } from '../types';
import {
  IkseongwanHeadwear,
  RankingStreakDecoration,
  SamoHeadwear,
  type RankingStreakTier,
} from './ranking-streak-decoration';

const COURT_TITLES = [
  '임금',
  '영의정',
  '좌의정',
  '우의정',
  '이조판서',
  '호조판서',
  '예조판서',
  '병조판서',
  '형조판서',
  '공조판서',
] as const;

function tierFor(days: number): RankingStreakTier {
  if (days >= 100) return 'celebration';
  if (days >= 30) return 'strong';
  if (days >= 7) return 'shimmer';
  return 'plain';
}

function headwearFor(rank: number): ReactNode {
  if (rank === 1) return <IkseongwanHeadwear />;
  return <SamoHeadwear small={rank >= 5} />;
}

export function RankingCourtMember({
  item,
}: {
  readonly item: PublicRankingItem;
}) {
  const href = `https://github.com/${item.githubLogin}`;
  const linkAriaLabel = `${item.githubLogin}의 GitHub 프로필 (새 탭에서 열림)`;
  const title = COURT_TITLES[item.rank - 1];
  if (
    title === undefined ||
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
  const days =
    item.rank === 1 ? item.streak.rankHeldDays : item.streak.top10Days;
  return (
    <RankingStreakDecoration
      rank={item.rank}
      title={title}
      days={days}
      tier={tierFor(days)}
      name={item.githubLogin}
      href={href}
      linkAriaLabel={linkAriaLabel}
      headwear={headwearFor(item.rank)}
    />
  );
}
