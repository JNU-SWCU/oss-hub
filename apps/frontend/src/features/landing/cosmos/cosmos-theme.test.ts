import { describe, expect, it } from 'vitest';
import { JOURNEY_BANDS, labelContrast } from './cosmos-contrast-test-support';
import {
  DAWN_THEME,
  LABEL_MIN_ALPHA,
  LABEL_PLATE_ALPHA,
  labelInk,
  NIGHT_THEME,
} from './cosmos-theme';

const NIGHT_INK = { text: NIGHT_THEME.label, plate: NIGHT_THEME.void };
const DAWN_INK = { text: DAWN_THEME.label, plate: DAWN_THEME.void };

describe('labelInk', () => {
  it('swaps text and plate together at the dawn midpoint instead of mixing them', () => {
    expect(labelInk(NIGHT_THEME, DAWN_THEME, 0)).toEqual(NIGHT_INK);
    expect(labelInk(NIGHT_THEME, DAWN_THEME, 0.49)).toEqual(NIGHT_INK);
    expect(labelInk(NIGHT_THEME, DAWN_THEME, 0.5)).toEqual(DAWN_INK);
    expect(labelInk(NIGHT_THEME, DAWN_THEME, 1)).toEqual(DAWN_INK);
  });

  it('keeps label text at least 4.5:1 against its plate on every journey band at every dawn mix', () => {
    for (let step = 0; step <= 20; step += 1) {
      const dayMix = step / 20;
      const ink = labelInk(NIGHT_THEME, DAWN_THEME, dayMix);
      for (const [band, color] of Object.entries(JOURNEY_BANDS)) {
        const ratio = labelContrast(
          { color: ink.text, alpha: LABEL_MIN_ALPHA },
          { color: ink.plate, alpha: LABEL_MIN_ALPHA * LABEL_PLATE_ALPHA },
          color,
        );
        expect(ratio, `dayMix ${dayMix} on ${band}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });
});
