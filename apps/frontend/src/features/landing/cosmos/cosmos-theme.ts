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

const COSMOS_VOID: CosmosColor = [0, 19, 58];
const PALETTE_WHITE: CosmosColor = [255, 255, 255];
const PALETTE_GREEN_300: CosmosColor = [92, 198, 135];
const PALETTE_NAVY_200: CosmosColor = [173, 193, 235];

export const NIGHT_THEME: CosmosTheme = {
  void: COSMOS_VOID,
  star: PALETTE_WHITE,
  edge: PALETTE_WHITE,
  label: PALETTE_WHITE,
  program: PALETTE_GREEN_300,
  student: PALETTE_NAVY_200,
  repository: PALETTE_WHITE,
};

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
