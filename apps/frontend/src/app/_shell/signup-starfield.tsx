import type { CSSProperties } from 'react';

import styles from './signup-starfield.module.css';

const VIEW_BOX_SIZE = 1000;

const PHASE_COUNT = 3;

function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildLayerPaths(count: number, random: () => number): string[] {
  const paths = Array.from({ length: PHASE_COUNT }, () => '');
  for (let index = 0; index < count; index += 1) {
    const x = (random() * VIEW_BOX_SIZE).toFixed(1);
    const y = (random() * VIEW_BOX_SIZE).toFixed(1);
    paths[index % PHASE_COUNT] += `M${x} ${y}h.01`;
  }
  return paths;
}

const random = createRandom(0x51701);

const STAR_LAYERS = [
  { count: 380, width: 0.9, opacity: 0.28, drift: 8, breath: 11.3, flow: 173 },
  { count: 190, width: 1.5, opacity: 0.42, drift: 12, breath: 8.7, flow: 149 },
  { count: 85, width: 2.6, opacity: 0.6, drift: 18, breath: 6.5, flow: 127 },
].map((layer) => ({ ...layer, paths: buildLayerPaths(layer.count, random) }));

export function SignupStarfield() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full text-cosmos-copy"
      viewBox={`0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}`}
      preserveAspectRatio="xMidYMid slice"
    >
      {STAR_LAYERS.map((layer) =>
        layer.paths.map((d, phase) => (
          <path
            key={`${layer.width}-${phase}`}
            className={styles.layer}
            style={
              {
                '--star-opacity': layer.opacity,
                '--star-drift': `${layer.drift}px`,
                '--star-breath': `${layer.breath}s`,
                '--star-flow': `${layer.flow}s`,

                '--star-phase': `${-(layer.breath / PHASE_COUNT) * phase}s`,
              } as CSSProperties
            }
            d={d}
            stroke="currentColor"
            strokeWidth={layer.width}
            strokeLinecap="round"
            opacity={layer.opacity}
          />
        )),
      )}
    </svg>
  );
}
