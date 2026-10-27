export const COSMOS_LABEL_GAP = 18;
export const COSMOS_LABEL_OFFSET = 6;
export const COSMOS_LABEL_PLATE_RADIUS = 4;

export interface CosmosLabelPlate {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function cosmosLabelText(text: string): string {
  return text.length > 28 ? `${text.slice(0, 27)}…` : text;
}

export function cosmosLabelWidth(text: string, size: number): number {
  let units = 0;
  for (const character of text) {
    if (character.charCodeAt(0) > 255) units += 1;
    else if (/[ilIj1.,' ]/.test(character)) units += 0.35;
    else if (/[mwMW]/.test(character)) units += 0.9;
    else if (/[A-Z]/.test(character)) units += 0.7;
    else units += 0.55;
  }
  return Math.ceil(units * size);
}

export function cosmosLabelPlate(
  size: number,
  width: number,
): CosmosLabelPlate {
  return {
    x: -4,
    y: -(size * 0.62 + 2),
    width: width + 8,
    height: size * 1.12 + 4,
  };
}
