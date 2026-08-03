import type { CSSProperties } from 'react';

import styles from './signup-starfield.module.css';

/**
 * 가입 동선 무대의 별밭(#517).
 *
 * 랜딩의 canvas 렌더 루프는 가져오지 않는다. 그것은 스크롤을 따라 카메라를 움직이는
 * 장치라 별 위치가 매 프레임 다시 계산되는데, 가입 폼에는 움직일 카메라가 없다.
 * 여기서는 같은 팔레트로 별 위치만 한 번 정해 SVG 한 장으로 굳힌다 — 렌더 루프도
 * canvas도 없고, 화질 거버너(`cosmos-quality.ts`)가 재는 프레임 예산에도 들어가지
 * 않는다. 움직임은 CSS 애니메이션이 대신 준다(`signup-starfield.module.css`, #522).
 *
 * 불변식 셋.
 * - 위치는 고정 seed에서 나온다. 매 렌더 다시 뽑으면 서버와 브라우저의 별자리가 달라져
 *   hydration이 갈린다.
 * - `slice`로 덮으므로 viewBox는 정사각형이어야 한다. 어느 폭에서도 별이 한쪽으로
 *   몰리거나 늘어나지 않는 것이 이 화면의 요구였다.
 * - `opacity` presentation 속성을 남겨 둔다. `prefers-reduced-motion: reduce`에서
 *   CSS가 `opacity`를 놓으면 이 값이 그대로 드러나 정지 별밭이 된다.
 */

const VIEW_BOX_SIZE = 1000;

/** 한 층을 몇 갈래 위상으로 쪼갤지. 층 전체가 한 박자로 밝아지면 하늘이 숨 쉬는 것처럼
 *  보인다 — 갈래를 나누면 밝아지는 별과 어두워지는 별이 섞인다. */
const PHASE_COUNT = 3;

/** mulberry32 — 값이 고정돼야 하므로 `Math.random`을 쓰지 않는다. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 한 층의 별을 점 하나짜리 subpath 목록으로 그린다. `stroke-linecap="round"` 덕에
 * 길이 0에 가까운 선이 동그란 점이 된다 — 별 하나에 요소 하나를 두지 않아도 된다.
 * 별을 뽑는 순서대로 위상 갈래에 돌려 담으므로 갈래끼리 자리가 섞인다.
 */
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

/**
 * 층마다 크기·밝기가 다르다 — 랜딩의 배경 별 3층과 같은 구성이다.
 *
 * 움직임 값도 층이 쥔다. 밝은 층일수록 앞에 있다고 보고 더 크게 흐르며(`drift`, viewBox
 * 1000 기준), 주기(`breath`·`flow`)는 서로 나누어떨어지지 않게 두어 세 층이 한 박자로
 * 겹치는 순간이 오지 않게 한다. 가장 앞 층이 1440px 화면에서 초당 0.4px 남짓 움직인다 —
 * 보고 있으면 흐르는 줄 알겠지만 시선을 끌지는 않는 속도다.
 */
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
                // 음수 지연 — 시작하자마자 각 갈래가 서로 다른 지점에 서 있다.
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
