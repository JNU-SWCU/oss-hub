export const COSMOS_LABEL_GAP = 18;

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
