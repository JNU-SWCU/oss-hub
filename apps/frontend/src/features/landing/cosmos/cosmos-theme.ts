/**
 * 우주 히어로의 색 세트. 배경 그라디언트·안개·별·오로라·노드색·글로우가
 * 전부 이 객체 하나에서 나온다 — 색을 바꾸려면 여기만 고친다.
 *
 * 진짜 우주는 남색이 아니라 검정이다. 아래쪽에만 아주 옅은 남색을 남겨
 * 완전한 무채색이 되지 않게 한다(사업단 주조색의 흔적).
 */
export type CosmosColor = readonly [number, number, number];

export interface CosmosTheme {
  readonly sky: readonly (readonly [number, string])[];
  /** 멀어질수록 노드가 수렴하는 색 = 배경 검정 */
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

export const DEEP_SPACE_THEME: CosmosTheme = {
  sky: [
    [0, '#000000'],
    [0.5, '#03040a'],
    [1, '#070a15'],
  ],
  fog: [3, 4, 10],
  star: [214, 224, 245],
  edge: [127, 156, 219],
  program: [255, 255, 255],
  programGlow: [186, 208, 255],
  studentTints: [
    [157, 185, 240],
    [173, 193, 235],
    [140, 170, 232],
    [186, 202, 244],
  ],
  repoTints: [
    [92, 198, 135],
    [42, 171, 99],
    [150, 220, 174],
    [63, 182, 160],
  ],
  // deep space는 남색이 주조. 초록은 한 겹만 섞어 사업단 보조색을 남긴다.
  aurora: [
    [79, 130, 210],
    [92, 198, 135],
    [104, 146, 226],
  ],
  auroraAlpha: 0.032,
  bloom: 0.4,
  nebulaTint: [79, 130, 210],
  focusNebulaTint: [92, 198, 135],
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
