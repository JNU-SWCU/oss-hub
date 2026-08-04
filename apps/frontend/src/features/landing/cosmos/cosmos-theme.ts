/**
 * 우주 히어로의 색 세트. 배경 그라디언트·안개·별·오로라·노드색·글로우가
 * 전부 이 객체 하나에서 나온다 — 색을 바꾸려면 여기만 고친다.
 *
 * 바탕은 검정이 아니라 사업단 주조색인 남색이다(#627). 위는 깊은 남색,
 * 아래로 갈수록 밝아져 대기권 위에서 지구를 내려다보는 인상을 만든다.
 * "진짜 우주는 검정"이 더 사실적이지만, 첫 화면이 온통 검정이면 무겁고
 * 브랜드 색이 드러나지 않는다는 판단이 앞섰다.
 *
 * ⚠ `sky[0]` 은 `globals.css` 의 `--cosmos-void` 와 같아야 한다. 다르면
 * 캔버스가 그려지기 전 한 프레임 동안 배경색이 튄다.
 */
export type CosmosColor = readonly [number, number, number];

export interface CosmosTheme {
  readonly sky: readonly (readonly [number, string])[];
  /** 멀어질수록 노드가 수렴하는 색 = 하늘 아래쪽 색 */
  readonly fog: CosmosColor;
  readonly star: CosmosColor;
  readonly edge: CosmosColor;
  readonly program: CosmosColor;
  readonly programGlow: CosmosColor;
  readonly studentTints: readonly CosmosColor[];
  readonly repoTints: readonly CosmosColor[];
  readonly aurora: readonly CosmosColor[];
  readonly auroraAlpha: number;
  readonly bloom: number;
  readonly nebulaTint: CosmosColor;
  readonly focusNebulaTint: CosmosColor;
}

export const DAWN_THEME: CosmosTheme = {
  sky: [
    [0, '#00133a'],
    [0.5, '#063a8f'],
    [1, '#1f5cc4'],
  ],
  // 안개는 하늘 아래쪽 색과 같다. 그래야 멀리 있는 노드가 배경으로 사라진다.
  fog: [31, 92, 196],
  // 바탕이 밝아진 만큼 별과 선도 함께 밝혀야 대비가 유지된다.
  star: [242, 247, 255],
  edge: [172, 198, 244],
  program: [255, 255, 255],
  programGlow: [214, 230, 255],
  studentTints: [
    [196, 216, 252],
    [214, 228, 253],
    [180, 205, 250],
    [224, 234, 254],
  ],
  // 저장소의 초록은 사업단 보조색이다. 밝은 남색 위에서 묻히지 않도록
  // deep space 시절보다 한 단계씩 밝게 올렸다.
  repoTints: [
    [126, 226, 166],
    [88, 208, 138],
    [176, 238, 198],
    [104, 214, 190],
  ],
  // 남색이 주조. 초록은 한 겹만 섞어 사업단 보조색을 남긴다.
  aurora: [
    [130, 178, 246],
    [104, 214, 154],
    [160, 196, 252],
  ],
  auroraAlpha: 0.09,
  bloom: 0.7,
  nebulaTint: [130, 178, 246],
  focusNebulaTint: [104, 214, 154],
};

export const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

export const segment = (p: number, a: number, b: number): number =>
  clamp01((p - a) / (b - a));

export const ease = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const rgba = (color: CosmosColor, alpha: number): string =>
  `rgba(${color[0] | 0},${color[1] | 0},${color[2] | 0},${
    alpha < 0 ? 0 : alpha > 1 ? 1 : alpha
  })`;

export const mix = (
  first: CosmosColor,
  second: CosmosColor,
  t: number,
): CosmosColor => [
  first[0] + (second[0] - first[0]) * t,
  first[1] + (second[1] - first[1]) * t,
  first[2] + (second[2] - first[2]) * t,
];

/** t > 0 이면 흰색 쪽으로, t < 0 이면 검정 쪽으로 */
export const shade = (color: CosmosColor, t: number): CosmosColor =>
  t >= 0 ? mix(color, [255, 255, 255], t) : mix(color, [0, 0, 0], -t);

export function tintAt(
  tints: readonly CosmosColor[],
  index: number,
): CosmosColor {
  return tints[index % tints.length] ?? tints[0] ?? [255, 255, 255];
}

/** 고정 시드 난수 — 매 로드 같은 배치가 나와야 한다 */
export function createRng(seed: number): () => number {
  let state = seed;
  return function rand(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
