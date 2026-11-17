import { describe, expect, it } from 'vitest';
import { groupAuditFeed } from './audit-log-feed';
import { parseAuditLogPage } from './parser';
import {
  AUDIT_LOG_PAGE_RESPONSE_FIXTURE,
  AUDIT_LOG_ROLE_CHANGE_RECORD_FIXTURE,
} from './fixtures';

function row(id: string, occurredAt: string, requestId: string | null) {
  return { ...AUDIT_LOG_ROLE_CHANGE_RECORD_FIXTURE, id, occurredAt, requestId };
}

describe('groupAuditFeed', () => {
  it('chains only adjacent rows of one request and keeps newest-first order', () => {
    const page = parseAuditLogPage({
      ...AUDIT_LOG_PAGE_RESPONSE_FIXTURE,
      items: [
        row('request-latest', '2026-11-17T06:00:00.000Z', 'request-1'),
        row('request-adjacent', '2026-11-17T05:00:00.000Z', 'request-1'),
        row('unrelated', '2026-11-17T04:00:00.000Z', null),
        row('request-after-gap', '2026-11-17T03:00:00.000Z', 'request-1'),
        row('other-request', '2026-11-17T02:00:00.000Z', 'request-2'),
        row('previous-day', '2026-11-16T05:00:00.000Z', 'request-2'),
      ],
    });

    const days = groupAuditFeed(page.items);

    expect(
      days.map((day) =>
        day.chains.map((chain) => [
          chain.head.id,
          chain.linked.map((record) => record.id),
        ]),
      ),
    ).toEqual([
      [
        ['request-latest', ['request-adjacent']],
        ['unrelated', []],
        ['request-after-gap', []],
        ['other-request', []],
      ],
      [['previous-day', []]],
    ]);
    expect(
      days
        .flatMap((day) =>
          day.chains.flatMap((chain) => [chain.head, ...chain.linked]),
        )
        .map((record) => record.id),
    ).toEqual(page.items.map((record) => record.id));
  });
});
