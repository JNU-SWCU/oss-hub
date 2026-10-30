import { useMemo } from 'react';
import type { CosmosProgram } from '../cosmos/cosmos-graph';
import { cosmosPosterMarkup } from '../cosmos/cosmos-poster-markup';
import styles from './cosmos-poster.module.css';

export function CosmosPoster({
  programs,
}: {
  readonly programs: readonly CosmosProgram[];
}) {
  const markup = useMemo(() => cosmosPosterMarkup(programs), [programs]);
  return (
    <div
      data-cosmos-poster=""
      aria-hidden="true"
      className={styles.poster}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
