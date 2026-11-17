import { describe, expect, it } from 'vitest';
import {
  parseAuditLogSearchParams,
  buildAuditLogSearchParams,
} from './audit-log-url-state';

const DEFAULTS = {
  q: '',
  category: '',
  action: '',
  from: '',
  to: '',
  view: 'feed',
  page: 1,
} as const;

describe('AuditLog URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&from=bad&to=bad&action=bad&category=BILLING&view=grid',
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
      from: '2026-01-01',
      to: '2026-02-01',
      view: 'table',
      page: 2,
    } as const;
    const params = buildAuditLogSearchParams(input);
    expect(params.toString()).toBe(
      'q=x+y&category=SUBMISSION&action=TEAM_CREATED&from=2026-01-01&to=2026-02-01&view=table&page=2',
    );
    expect(parseAuditLogSearchParams(params)).toEqual(input);
  });
});
