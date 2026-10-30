export type CosmosColor = readonly [number, number, number];

export interface CosmosTheme {
  readonly void: CosmosColor;
  readonly star: CosmosColor;
  readonly edge: CosmosColor;
  readonly label: CosmosColor;
  readonly program: CosmosColor;
  readonly student: CosmosColor;
  readonly repository: CosmosColor;
}

const COSMOS_INK: CosmosColor = [5, 10, 26];
const COSMOS_SKY: CosmosColor = [233, 241, 248];
const COSMOS_PROGRAM: CosmosColor = [242, 212, 155];
const COSMOS_STUDENT: CosmosColor = [201, 214, 255];
const COSMOS_REPOSITORY_STAR: CosmosColor = [154, 163, 181];
const PALETTE_WHITE: CosmosColor = [255, 255, 255];
const PALETTE_AMBER_800: CosmosColor = [128, 88, 20];
const PALETTE_NAVY_600: CosmosColor = [0, 51, 153];
const PALETTE_NAVY_950: CosmosColor = [0, 13, 41];

export const NIGHT_THEME: CosmosTheme = {
  void: COSMOS_INK,
  star: PALETTE_WHITE,
  edge: PALETTE_WHITE,
  label: PALETTE_WHITE,
  program: COSMOS_PROGRAM,
  student: COSMOS_STUDENT,
  repository: COSMOS_REPOSITORY_STAR,
};

export const DAWN_THEME: CosmosTheme = {
  void: COSMOS_SKY,
  star: PALETTE_WHITE,
  edge: PALETTE_NAVY_950,
  label: PALETTE_NAVY_950,
  program: PALETTE_AMBER_800,
  student: PALETTE_NAVY_600,
  repository: PALETTE_NAVY_950,
};

export const LABEL_MIN_ALPHA = 0.85;
export const LABEL_PLATE_ALPHA = 0.75;

export interface CosmosLabelInk {
  readonly text: CosmosColor;
  readonly plate: CosmosColor;
}

export const labelInk = (
  night: CosmosTheme,
  day: CosmosTheme,
  dayMix: number,
): CosmosLabelInk =>
  dayMix < 0.5
    ? { text: night.label, plate: night.void }
    : { text: day.label, plate: day.void };

const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const mixColor = (
  a: CosmosColor,
  b: CosmosColor,
  t: number,
): CosmosColor =>
  t <= 0
    ? a
    : t >= 1
      ? b
      : [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export const rgba = (color: CosmosColor, alpha: number): string =>
  `rgba(${color[0] | 0},${color[1] | 0},${color[2] | 0},${
    alpha < 0 ? 0 : alpha > 1 ? 1 : alpha
  })`;

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
