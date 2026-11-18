'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import styles from './ranking-streak-decoration.module.css';

export type RankingStreakTier = 'plain' | 'shimmer' | 'strong' | 'celebration';

interface RankingStreakDecorationProps {
  readonly rank: number;
  readonly title: string;
  readonly days: number;
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
  title,
  days,
  tier,
  name,
  href,
  linkAriaLabel,
  headwear = <IkseongwanHeadwear />,
  interactionSlot,
}: RankingStreakDecorationProps) {
  const [firstCharacter, remainder] = splitFirstGrapheme(name);
  const [entered, setEntered] = useState(false);
  const [interaction, setInteraction] = useState(0);

  useEffect(() => setEntered(true), []);

  return (
    <span className={styles.anchor} data-streak-entered={entered || undefined}>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={linkAriaLabel}
        className="break-keep whitespace-normal hover:underline"
      >
        <span className={styles.firstCharacter} data-streak-first-character>
          {firstCharacter}
          <span
            key={interaction}
            aria-hidden="true"
            className={styles.headwear}
            data-streak-headwear
            data-streak-interaction={interaction}
          >
            {headwear}
          </span>
        </span>
        {remainder}
      </a>
      <span className="sr-only">
        {title} · {rank}위 {days}일째 유지
      </span>
      <Button
        type="button"
        variant="bare"
        size="content"
        className={cn(styles.tag, styles[tier])}
        aria-label={`${title} 장식 효과 재생`}
        onClick={() => setInteraction((value) => value + 1)}
        data-ranking-streak-tier={tier}
      >
        <span aria-hidden="true">
          <span className={styles.title}>{title}</span>{' '}
          <span className={styles.days}>{days}일째</span>
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

export function IkseongwanHeadwear() {
  return (
    <svg viewBox="0 0 44 28" className={styles.ikseongwan} focusable="false">
      <path
        className={styles.crownBody}
        d="M9 22c1-9 5-15 13-15s12 6 13 15H9Z"
      />
      <path className={styles.leftWing} d="M10 10 2 4l4 12 6 2" />
      <path className={styles.rightWing} d="m34 10 8-6-4 12-6 2" />
      <path className={styles.crownBand} d="M7 22h30v4H7z" />
    </svg>
  );
}

export function SamoHeadwear({ small = false }: { readonly small?: boolean }) {
  return (
    <svg
      viewBox="0 0 44 26"
      className={cn(styles.samo, small && styles.smallSamo)}
      focusable="false"
    >
      <path d="M10 20c1-9 5-14 12-14s11 5 12 14H10Z" />
      <path d="m11 11-9 3 9 4m22-7 9 3-9 4" />
      <path d="M8 20h28v4H8z" />
    </svg>
  );
}
