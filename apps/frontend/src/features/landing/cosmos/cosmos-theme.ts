export type CosmosColor = readonly [number, number, number];

export interface CosmosTheme {
  readonly sky: readonly (readonly [number, string])[];

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

  fog: [31, 92, 196],

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

  repoTints: [
    [126, 226, 166],
    [88, 208, 138],
    [176, 238, 198],
    [104, 214, 190],
  ],

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

export const shade = (color: CosmosColor, t: number): CosmosColor =>
  t >= 0 ? mix(color, [255, 255, 255], t) : mix(color, [0, 0, 0], -t);

export function tintAt(
  tints: readonly CosmosColor[],
  index: number,
): CosmosColor {
  return tints[index % tints.length] ?? tints[0] ?? [255, 255, 255];
}

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
