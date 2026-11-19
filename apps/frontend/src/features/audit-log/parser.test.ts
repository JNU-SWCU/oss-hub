import { describe, expect, it } from 'vitest';
import { AuditLogResponseError, parseAuditLogPage } from './parser';
import {
  AUDIT_LOG_PAGE_RESPONSE_FIXTURE,
  AUDIT_LOG_ROLE_CHANGE_RECORD_FIXTURE,
} from './fixtures';

function pageWith(item: Record<string, unknown>) {
  return { ...AUDIT_LOG_PAGE_RESPONSE_FIXTURE, items: [item] };
}

describe('parseAuditLogPage', () => {
  it('returns raw parts and category counts from the backend', () => {
    const page = parseAuditLogPage(AUDIT_LOG_PAGE_RESPONSE_FIXTURE);

    expect(page.counts).toEqual(AUDIT_LOG_PAGE_RESPONSE_FIXTURE.counts);
    expect(page.items[0]).toEqual({
      id: 'audit-role-change',
      occurredAt: '2026-11-17T05:03:00.000Z',
      action: 'USER_ROLE_CHANGED',
      category: 'ACCOUNT',
      actor: AUDIT_LOG_ROLE_CHANGE_RECORD_FIXTURE.actor,
      target: AUDIT_LOG_ROLE_CHANGE_RECORD_FIXTURE.target,
      change: { field: 'role', before: 'STUDENT', after: 'STAFF' },
      requestId: null,
      teamMembership: null,
      phoneTransition: null,
      mailDelivery: null,
    });
  });

  it.each([
    ['PROGRAM_MAIL_PARTIALLY_FAILED', 1, 1],
    ['PROGRAM_MAIL_DELIVERY_UNKNOWN', 0, 2],
  ] as const)(
    'preserves delivery counts for %s',
    (action, failedCount, unknownCount) => {
      const counts = {
        sentCount: 0,
        duplicateCount: 0,
        failedCount,
        unknownCount,
      };
      const page = parseAuditLogPage(
        pageWith({
          ...AUDIT_LOG_ROLE_CHANGE_RECORD_FIXTURE,
          action,
          metadata: { schemaVersion: 1, ...counts },
        }),
      );
      expect(page.items[0]?.mailDelivery).toEqual(counts);
    },
  );

  it('keeps backend-decided team membership facts as given', () => {
    const page = parseAuditLogPage(
      pageWith({
        ...AUDIT_LOG_ROLE_CHANGE_RECORD_FIXTURE,
        action: 'TEAM_MEMBERSHIP_CHANGED',
        teamMembership: {
          operation: 'REMOVE',
          leaderChanged: false,
          teamDeleted: true,
        },
      }),
    );

    expect(page.items[0]?.teamMembership).toEqual({
      operation: 'REMOVE',
      leaderChanged: false,
      teamDeleted: true,
    });
  });

  it('keeps boolean grant changes as raw facts', () => {
    const page = parseAuditLogPage(
      pageWith({
        ...AUDIT_LOG_ROLE_CHANGE_RECORD_FIXTURE,
        action: 'REVOKE_STAFF_ACCESS',
        change: { field: 'hasStaffAccess', before: true, after: false },
      }),
    );

    expect(page.items[0]?.change).toEqual({
      field: 'hasStaffAccess',
      before: true,
      after: false,
    });
  });

  it('reads the stored phone transition only for phone updates', () => {
    const phone = parseAuditLogPage(
      pageWith({
        ...AUDIT_LOG_ROLE_CHANGE_RECORD_FIXTURE,
        action: 'USER_PHONE_UPDATED',
        metadata: { schemaVersion: 1, transition: 'REPLACED' },
      }),
    );

    expect(phone.items[0]?.phoneTransition).toBe('REPLACED');
  });

  it.each([
    ['legacy display strings', { actorHandle: 'old' }],
    ['an unknown category', { category: 'BILLING' }],
    ['a string actor', { actor: 'synthetic-admin' }],
    ['a target without parts', { target: { type: 'USER', id: 'x' } }],
    ['a malformed membership', { teamMembership: { operation: 'LEAVE' } }],
    ['a change without its field', { change: { before: 'A', after: 'B' } }],
    ['a numeric change value', { change: { field: 'x', before: 1, after: 2 } }],
    ['metadata on a legacy row', { legacy: true }],
  ])('rejects %s', (_name, override) => {
    expect(() =>
      parseAuditLogPage(
        pageWith({ ...AUDIT_LOG_ROLE_CHANGE_RECORD_FIXTURE, ...override }),
      ),
    ).toThrow(AuditLogResponseError);
  });

  it('rejects a page without category counts', () => {
    const { items, total, page, limit } = AUDIT_LOG_PAGE_RESPONSE_FIXTURE;
    const withoutCounts = { items, total, page, limit };

    expect(() => parseAuditLogPage(withoutCounts)).toThrow(
      AuditLogResponseError,
    );
  });
});
