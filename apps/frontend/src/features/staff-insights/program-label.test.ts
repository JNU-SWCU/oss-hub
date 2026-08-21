import { describe, expect, it } from 'vitest';
import { formatProgramChartLabel } from './program-label';

describe('formatProgramChartLabel', () => {
  it('keeps a ZWJ emoji intact at the truncation boundary', () => {
    // Given: the eleventh grapheme is a multi-code-point ZWJ emoji.
    const name = '가나다라마바사아자차👩‍💻후속프로그램';

    // When: the chart label is shortened to twelve visible graphemes.
    const label = formatProgramChartLabel(name);

    // Then: the complete emoji occupies one grapheme before the ellipsis.
    expect(label).toBe('가나다라마바사아자차👩‍💻…');
  });

  it('leaves a label at the visible limit unchanged', () => {
    // Given: the label fits exactly within the chart limit.
    const name = '가나다라마바사아자차카타';

    // When: the chart label is formatted.
    const label = formatProgramChartLabel(name);

    // Then: no ellipsis is added.
    expect(label).toBe(name);
  });
});
