import { describe, expect, it } from 'vitest';
import { resolveAuditLogActionBadge } from './audit-log-action';
import { describeAuditLog } from './describe';
import { parseAuditLogPage } from './parser';

describe('domain history in the existing audit feed', () => {
  it.each([
    {
      id: 'user:signup',
      action: 'SIGNED_UP',
      variant: 'approved',
      targetType: 'USER',
      metadata: { recordKind: 'SIGNUP' },
    },
    {
      id: 'user:type-selection',
      action: 'USER_ROLE_CHANGED',
      variant: 'closed',
      targetType: 'USER',
      metadata: {
        recordKind: 'TYPE_SELECTION',
        before: 'UNSELECTED',
        after: 'STUDENT',
      },
    },
    {
      id: 'user:request',
      action: 'APPROVAL_REQUESTED',
      variant: 'pending',
      targetType: 'ROLE_REQUEST',
      metadata: {
        recordKind: 'REQUEST_TRANSITION',
        requestId: 'request-1',
        status: 'PENDING',
      },
    },
    {
      id: 'user:replace',
      action: 'REQUEST_SUPERSEDED',
      variant: 'closed',
      targetType: 'ROLE_REQUEST',
      metadata: {
        recordKind: 'REQUEST_TRANSITION',
        requestId: 'request-1',
        status: 'REVOKED',
        cause: 'SUPERSEDED',
        replacementRequestId: 'request-2',
      },
    },
    {
      id: 'user:approve',
      action: 'APPROVED',
      variant: 'approved',
      targetType: 'ROLE_REQUEST',
      metadata: {
        recordKind: 'REQUEST_TRANSITION',
        requestId: 'request-2',
        status: 'APPROVED',
        cause: 'ADMIN_TYPE_CHANGE',
      },
    },
    {
      id: 'user:revoke',
      action: 'REVOKED',
      variant: 'closed',
      targetType: 'ROLE_REQUEST',
      metadata: {
        recordKind: 'REQUEST_TRANSITION',
        requestId: 'request-2',
        status: 'REVOKED',
        cause: 'TYPE_CHANGED',
      },
    },
    {
      id: 'admin:bootstrap',
      action: 'GRANT_ADMIN_ACCESS',
      variant: 'approved',
      targetType: 'USER',
      metadata: { recordKind: 'BOOTSTRAP' },
    },
  ] as const)('renders $id without losing identity or target', (event) => {
    const page = parseAuditLogPage({
      items: [
        {
          id: event.id,
          action: event.action,
          actor: 'synthetic-actor',
          actorHandle: 'synthetic-actor',
          targetType: event.targetType,
          targetId:
            'requestId' in event.metadata
              ? event.metadata.requestId
              : 'synthetic-user',
          target: 'synthetic-target',
          targetHandle: 'synthetic-target',
          occurredAt: '2026-11-02T00:00:00.000Z',
          legacy: false,
          metadata: { schemaVersion: 1, ...event.metadata },
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    const record = page.items[0];
    if (!record) throw new TypeError('History row missing');

    expect(record.id).toBe(event.id);
    if ('before' in event.metadata) {
      expect(record.typeSelection).toEqual({
        before: event.metadata.before,
        after: event.metadata.after,
      });
      expect(
        resolveAuditLogActionBadge(record.action, record.typeSelection).label,
      ).not.toBe(resolveAuditLogActionBadge(record.action).label);
    }
    expect(resolveAuditLogActionBadge(record.action).variant).toBe(
      event.variant,
    );
    const { sentence } = describeAuditLog(record);
    expect(sentence.some((part) => part.kind === 'code')).toBe(false);
    expect(sentence).toContainEqual({
      kind: 'target',
      value: 'synthetic-target',
      variant: 'handle',
    });
  });
});
