import { describe, expect, it } from 'vitest';
import {
  parseAuditLogSearchParams,
  buildAuditLogSearchParams,
} from './audit-log-url-state';

const DEFAULTS = {
  q: '',
  category: '',
  action: '',
  period: '30d',
  from: '',
  to: '',
  view: 'feed',
  page: 1,
} as const;

describe('AuditLog URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&from=bad&to=bad&action=bad&category=BILLING&view=grid&period=1y',
    );
    expect(parseAuditLogSearchParams(input)).toEqual(DEFAULTS);
  });

  it('omits defaults from the address', () => {
    expect(buildAuditLogSearchParams(DEFAULTS).toString()).toBe('');
  });

  it('round trips nondefault shareable state', () => {
    const input = {
      q: 'x y',
      category: 'SUBMISSION',
      action: 'TEAM_CREATED',
      period: 'custom',
      from: '2026-01-01',
      to: '2026-02-01',
      view: 'table',
      page: 2,
    } as const;
    const params = buildAuditLogSearchParams(input);
    expect(params.toString()).toBe(
      'q=x+y&category=SUBMISSION&action=TEAM_CREATED&period=custom&from=2026-01-01&to=2026-02-01&view=table&page=2',
    );
    expect(parseAuditLogSearchParams(params)).toEqual(input);
  });

  it('reads an address that only carries dates as a custom period', () => {
    const state = parseAuditLogSearchParams(
      new URLSearchParams('from=2026-01-01'),
    );

    expect(state).toEqual({
      ...DEFAULTS,
      period: 'custom',
      from: '2026-01-01',
    });
  });

  it('drops dates once a preset period is chosen', () => {
    const state = parseAuditLogSearchParams(
      new URLSearchParams('period=7d&from=2026-01-01&to=2026-02-01'),
    );

    expect(state).toEqual({ ...DEFAULTS, period: '7d' });
    expect(buildAuditLogSearchParams(state).toString()).toBe('period=7d');
  });
});
