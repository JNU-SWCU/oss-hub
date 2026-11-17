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
  it('links rows of one request under its newest row even when other rows interleave', () => {
    const page = parseAuditLogPage({
      ...AUDIT_LOG_PAGE_RESPONSE_FIXTURE,
      items: [
        row('request-latest', '2026-11-17T05:00:00.000Z', 'request-1'),
        row('unrelated', '2026-11-17T04:00:00.000Z', null),
        row('request-earlier', '2026-11-17T03:00:00.000Z', 'request-1'),
        row('other-request', '2026-11-17T02:00:00.000Z', 'request-2'),
        row('previous-day', '2026-11-16T05:00:00.000Z', 'request-1'),
      ],
    });

    expect(
      groupAuditFeed(page.items).map((day) =>
        day.chains.map((chain) => [
          chain.head.id,
          chain.linked.map((record) => record.id),
        ]),
      ),
    ).toEqual([
      [
        ['request-latest', ['request-earlier']],
        ['unrelated', []],
        ['other-request', []],
      ],
      [['previous-day', []]],
    ]);
  });
});
