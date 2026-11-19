'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RankHeadwear } from './ranking-rank-headwear';
import styles from './ranking-streak-decoration.module.css';

export type RankingStreakTier = 'plain' | 'shimmer' | 'strong' | 'celebration';

interface RankingStreakDecorationProps {
  readonly rank: number;
  readonly accessibleTierName: string;
  readonly days: number;
  readonly tenureLabel: '1위' | 'TOP 10';
  readonly tier: RankingStreakTier;
  readonly name: string;
  readonly href: string;
  readonly linkAriaLabel: string;
  readonly headwear?: ReactNode;
  readonly interactionSlot?: ReactNode;
}

function splitFirstGrapheme(value: string): readonly [string, string] {
  const first = [
    ...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(value),
  ][0]?.segment;
  return first === undefined ? ['', ''] : [first, value.slice(first.length)];
}

export function RankingStreakDecoration({
  rank,
  accessibleTierName,
  days,
  tenureLabel,
  tier,
  name,
  href,
  linkAriaLabel,
  headwear = <RankHeadwear rank={rank} />,
  interactionSlot,
}: RankingStreakDecorationProps) {
  const [firstCharacter, remainder] = splitFirstGrapheme(name);
  const [entered, setEntered] = useState(false);
  const [interaction, setInteraction] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const streakMeaning = `${tenureLabel} 유지 ${days}일째`;

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => setReducedMotion(preference.matches);
    syncPreference();
    preference.addEventListener('change', syncPreference);
    setEntered(true);
    return () => preference.removeEventListener('change', syncPreference);
  }, []);

  return (
    <span
      className={styles.anchor}
      data-streak-entered={entered || undefined}
      data-streak-reduced-motion={reducedMotion || undefined}
    >
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={linkAriaLabel}
        className={cn(
          styles.nameLink,
          'break-keep whitespace-normal hover:underline',
        )}
        data-streak-name
      >
        <span className={styles.nameText} data-streak-name-text>
          <span className={styles.firstCharacter} data-streak-first-character>
            {firstCharacter}
          </span>
          {remainder}
        </span>
        <span
          key={interaction}
          aria-hidden="true"
          className={styles.headwear}
          data-streak-headwear
          data-streak-interaction={interaction}
        >
          {headwear}
        </span>
      </a>
      <span className="sr-only" data-streak-accessible-name>
        {accessibleTierName}
      </span>
      <Button
        type="button"
        variant="bare"
        size="content"
        className={cn(styles.tag, styles[tier])}
        aria-label={streakMeaning}
        title={streakMeaning}
        onClick={() => {
          if (!reducedMotion) setInteraction((value) => value + 1);
        }}
        data-ranking-streak-tier={tier}
      >
        <span className={styles.days} data-day-count aria-hidden="true">
          {days}일째
        </span>
        {interactionSlot}
        {tier === 'celebration' && interaction > 0 ? (
          <span
            key={interaction}
            aria-hidden="true"
            className={styles.confetti}
            data-streak-confetti
          >
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        ) : null}
      </Button>
    </span>
  );
}
