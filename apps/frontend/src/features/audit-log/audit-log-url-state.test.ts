import { describe, expect, it } from 'vitest';
import {
  parseAuditLogSearchParams,
  buildAuditLogSearchParams,
} from './audit-log-url-state';

describe('AuditLog URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&sort=bad&status=bad&filter=bad&year=bad&granularity=bad&from=bad&to=bad&action=bad',
    );
    expect(parseAuditLogSearchParams(input)).toEqual({
      actor: '',
      action: '',
      from: '',
      to: '',
      page: 1,
    });
  });

  it('omits defaults from the address', () => {
    expect(
      buildAuditLogSearchParams({
        actor: '',
        action: '',
        from: '',
        to: '',
        page: 1,
      }).toString(),
    ).toBe('');
  });

  it('round trips nondefault shareable state', () => {
    const input = {
      actor: 'x y',
      action: 'TEAM_CREATED',
      from: '2026-01-01',
      to: '2026-02-01',
      page: 2,
    } as const;
    const params = buildAuditLogSearchParams(input);
    expect(params.toString()).toBe(
      'actor=x+y&action=TEAM_CREATED&from=2026-01-01&to=2026-02-01&page=2',
    );
    expect(parseAuditLogSearchParams(params)).toEqual(input);
  });
});
