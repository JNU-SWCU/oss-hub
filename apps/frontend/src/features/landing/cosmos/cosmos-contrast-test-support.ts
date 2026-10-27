import type { CosmosColor } from './cosmos-theme';

export const JOURNEY_BANDS: Readonly<Record<string, CosmosColor>> = {
  ink: [5, 10, 26],
  deep: [19, 31, 67],
  dusk: [59, 52, 98],
  horizon: [148, 130, 153],
  dawn: [215, 189, 192],
  peach: [235, 218, 212],
  sky: [233, 241, 248],
  background: [255, 255, 255],
};

export interface AlphaColor {
  readonly color: CosmosColor;
  readonly alpha: number;
}

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: CosmosColor): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

const contrastRatio = (a: CosmosColor, b: CosmosColor): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const composite = (
  { color, alpha }: AlphaColor,
  bg: CosmosColor,
): CosmosColor => [
  color[0] * alpha + bg[0] * (1 - alpha),
  color[1] * alpha + bg[1] * (1 - alpha),
  color[2] * alpha + bg[2] * (1 - alpha),
];

export const labelContrast = (
  text: AlphaColor,
  plate: AlphaColor,
  band: CosmosColor,
): number => {
  const plateOnBand = composite(plate, band);
  return contrastRatio(composite(text, plateOnBand), plateOnBand);
};

export const parseRgba = (css: string): AlphaColor => {
  const match = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(css);
  if (!match) throw new Error(`rgba() 문자열이 아닙니다: ${css}`);
  return {
    color: [Number(match[1]), Number(match[2]), Number(match[3])],
    alpha: Number(match[4]),
  };
};
