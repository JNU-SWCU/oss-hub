import type { ReactNode } from 'react';
import styles from './ranking-streak-decoration.module.css';

export function RankHeadwear({ rank }: { readonly rank: number }) {
  const shape = headwearShape(rank);
  return (
    <svg
      viewBox="0 0 48 30"
      className={styles.rankHeadwear}
      focusable="false"
      data-headwear-kind={shape.kind}
      data-headwear-rank={rank}
    >
      {shape.paths}
    </svg>
  );
}

function headwearShape(rank: number): {
  readonly kind: string;
  readonly paths: ReactNode;
} {
  switch (rank) {
    case 1:
      return {
        kind: 'winged-crown',
        paths: (
          <>
            <path
              className={styles.hatBase}
              d="M12 23c1-10 5-16 12-16s11 6 12 16H12Z"
            />
            <path className={styles.leftWing} d="M12 12 2 4l5 13 7 2" />
            <path className={styles.rightWing} d="m36 12 10-8-5 13-7 2" />
            <path className={styles.hatBand} d="M9 22h30v5H9z" />
          </>
        ),
      };
    case 2:
      return {
        kind: 'triple-peak',
        paths: (
          <>
            <path
              className={styles.hatBase}
              d="M10 23 14 8l6 7 4-12 4 12 6-7 4 15H10Z"
            />
            <path className={styles.hatBand} d="M8 22h32v5H8z" />
          </>
        ),
      };
    case 3:
      return {
        kind: 'left-plume',
        paths: (
          <>
            <path
              className={styles.hatBase}
              d="M14 23c0-10 4-15 11-15s10 5 10 15H14Z"
            />
            <path className={styles.hatAccent} d="M15 15 3 6l6 14 7-1Z" />
            <path className={styles.hatBand} d="M11 22h28v5H11z" />
          </>
        ),
      };
    case 4:
      return {
        kind: 'square-seal',
        paths: (
          <>
            <path className={styles.hatBase} d="M14 7h20l3 16H11L14 7Z" />
            <path className={styles.hatAccent} d="m24 11 5 5-5 5-5-5 5-5Z" />
            <path className={styles.hatBand} d="M8 22h32v5H8z" />
          </>
        ),
      };
    case 5:
      return {
        kind: 'round-fins',
        paths: (
          <>
            <path
              className={styles.hatAccent}
              d="m13 15-11 3 11 4m22-7 11 3-11 4"
            />
            <path
              className={styles.hatBase}
              d="M13 23c1-11 5-16 11-16s10 5 11 16H13Z"
            />
            <path className={styles.hatBand} d="M9 22h30v5H9z" />
          </>
        ),
      };
    case 6:
      return {
        kind: 'flat-stripe',
        paths: (
          <>
            <path className={styles.hatBase} d="M11 13h26l-2 10H13l-2-10Z" />
            <path className={styles.hatAccent} d="M7 9h34v6H7z" />
            <path className={styles.hatBand} d="M9 22h30v5H9z" />
          </>
        ),
      };
    case 7:
      return {
        kind: 'twin-tabs',
        paths: (
          <>
            <path
              className={styles.hatAccent}
              d="M14 12 4 7l6 13 6-2m18-6 10-5-6 13-6-2"
            />
            <path className={styles.hatBase} d="m15 23 3-17h12l3 17H15Z" />
            <path className={styles.hatBand} d="M11 22h26v5H11z" />
          </>
        ),
      };
    case 8:
      return {
        kind: 'pointed-helm',
        paths: (
          <>
            <path className={styles.hatAccent} d="m24 2 5 8H19l5-8Z" />
            <path
              className={styles.hatBase}
              d="M12 23c2-9 6-14 12-14s10 5 12 14H12Z"
            />
            <path className={styles.hatBand} d="M9 22h30v5H9z" />
          </>
        ),
      };
    case 9:
      return {
        kind: 'split-crown',
        paths: (
          <>
            <path className={styles.hatBase} d="M11 23 15 6l9 9 9-9 4 17H11Z" />
            <path className={styles.hatAccent} d="M22 8h4v14h-4z" />
            <path className={styles.hatBand} d="M8 22h32v5H8z" />
          </>
        ),
      };
    default:
      return {
        kind: 'orb-brim',
        paths: (
          <>
            <circle className={styles.hatAccent} cx="24" cy="10" r="7" />
            <path
              className={styles.hatBase}
              d="M13 23c2-7 5-11 11-11s9 4 11 11H13Z"
            />
            <path className={styles.hatBand} d="M8 22h32v5H8z" />
          </>
        ),
      };
  }
}
