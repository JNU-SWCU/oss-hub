import { describe, expect, it } from 'vitest';
import { formatProgramChartLabel } from './program-label';

describe('formatProgramChartLabel', () => {
  it('keeps a ZWJ emoji intact at the truncation boundary', () => {
    const name = '가나다라마바사아자차👩‍💻후속프로그램';

    const label = formatProgramChartLabel(name);

    expect(label).toBe('가나다라마바사아자차👩‍💻…');
  });

  it('leaves a label at the visible limit unchanged', () => {
    const name = '가나다라마바사아자차카타';

    const label = formatProgramChartLabel(name);

    expect(label).toBe(name);
  });
});
