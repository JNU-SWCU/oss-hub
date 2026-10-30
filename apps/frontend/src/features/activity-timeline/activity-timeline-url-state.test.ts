import { describe, expect, it } from 'vitest';
import {
  parseActivityTimelineSearchParams,
  buildActivityTimelineSearchParams,
} from './activity-timeline-url-state';

describe('ActivityTimeline URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&sort=bad&status=bad&filter=bad&year=bad&granularity=bad&from=bad&to=bad&action=bad',
    );
    expect(parseActivityTimelineSearchParams(input)).toEqual({
      granularity: 'MONTH',
    });
  });

  it('omits defaults from the address', () => {
    expect(
      buildActivityTimelineSearchParams({ granularity: 'MONTH' }).toString(),
    ).toBe('');
  });

  it('round trips nondefault shareable state', () => {
    const input = { granularity: 'YEAR' } as const;
    const params = buildActivityTimelineSearchParams(input);
    expect(params.toString()).toBe('granularity=YEAR');
    expect(parseActivityTimelineSearchParams(params)).toEqual(input);
  });
});
