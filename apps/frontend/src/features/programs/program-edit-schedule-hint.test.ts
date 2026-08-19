import { describe, expect, it } from 'vitest';
import { formatSeoulDate } from './program-detail-format';
import {
  earliestInstant,
  latestInstant,
  programEndBoundHint,
  programStartBoundHint,
} from './program-edit-schedule-hint';

const EARLY_START = '2026-08-18T03:41:00.000Z';
const LATE_START = '2026-08-18T03:42:00.000Z';
const EARLY_DUE = '2026-08-29T03:41:00.000Z';
const LATE_DUE = '2026-08-29T03:42:00.000Z';

describe('program-edit-schedule-hint', () => {
  it('picks the earliest start and latest due from the milestone list', () => {
    expect(earliestInstant([LATE_START, EARLY_START])).toBe(EARLY_START);
    expect(latestInstant([EARLY_DUE, LATE_DUE])).toBe(LATE_DUE);
    expect(earliestInstant([])).toBeNull();
    expect(latestInstant([])).toBeNull();
  });

  it('names the bound that blocks moving program start later', () => {
    expect(programStartBoundHint([])).toBeNull();
    expect(programStartBoundHint([LATE_START, EARLY_START])).toBe(
      `가장 이른 마일스톤 시작은 ${formatSeoulDate(EARLY_START)}입니다. 운영 시작은 이 시각과 같거나 빨라야 합니다.`,
    );
  });

  it('names the bound that blocks moving program end earlier', () => {
    expect(programEndBoundHint([])).toBeNull();
    expect(programEndBoundHint([EARLY_DUE, LATE_DUE])).toBe(
      `가장 늦은 마일스톤 마감은 ${formatSeoulDate(LATE_DUE)}입니다. 종료일은 이 시각 이후여야 합니다.`,
    );
  });
});
