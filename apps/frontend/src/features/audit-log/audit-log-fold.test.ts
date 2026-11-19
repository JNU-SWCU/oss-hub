import { describe, expect, it } from 'vitest';
import { foldAuditFeed, type AuditFeedDay } from './audit-log-fold';
import { AUDIT_LOG_PAGE_RESPONSE_FIXTURE } from './fixtures';
import { parseAuditLogPage } from './parser';
import type { AuditLogRecord } from './types';

const base = parseAuditLogPage(AUDIT_LOG_PAGE_RESPONSE_FIXTURE).items[0];

function login(
  id: string,
  occurredAt: string,
  action = 'LOGIN',
): AuditLogRecord {
  return { ...base, id, occurredAt, action, category: 'LOGIN' };
}

function change(id: string, occurredAt: string): AuditLogRecord {
  return { ...base, id, occurredAt };
}

function shape(days: readonly AuditFeedDay[]) {
  return days.map((day) => ({
    day: day.key,
    items: day.items.map((item) =>
      item.kind === 'run'
        ? {
            run: item.key,
            ids: item.records.map((record) => record.id),
            failures: item.failures,
            from: item.from,
            to: item.to,
          }
        : { event: item.record.id },
    ),
  }));
}

const RECORDS = [
  login('l5', '2026-11-19T04:58:00.000Z'),
  login('l4', '2026-11-19T04:55:00.000Z'),
  login('l3', '2026-11-19T04:51:00.000Z', 'LOGIN_FAILED'),
  change('c2', '2026-11-19T04:41:00.000Z'),
  login('l2', '2026-11-19T03:36:00.000Z', 'LOGOUT'),
  login('l1', '2026-11-19T03:30:00.000Z'),
  change('c1', '2026-11-19T02:58:00.000Z'),
  login('l0', '2026-11-19T01:41:00.000Z'),
  change('c0', '2026-11-19T01:36:00.000Z'),
  login('y2', '2026-11-18T05:21:00.000Z'),
  login('y1', '2026-11-18T05:16:00.000Z'),
];

const FOLDED = [
  {
    day: '2026-11-19',
    items: [
      {
        run: 'run:l3',
        ids: ['l5', 'l4', 'l3'],
        failures: 1,
        from: '2026-11-19T04:51:00.000Z',
        to: '2026-11-19T04:58:00.000Z',
      },
      { event: 'c2' },
      {
        run: 'run:l1',
        ids: ['l2', 'l1'],
        failures: 0,
        from: '2026-11-19T03:30:00.000Z',
        to: '2026-11-19T03:36:00.000Z',
      },
      { event: 'c1' },
      { event: 'l0' },
      { event: 'c0' },
    ],
  },
  {
    day: '2026-11-18',
    items: [
      {
        run: 'run:y1',
        ids: ['y2', 'y1'],
        failures: 0,
        from: '2026-11-18T05:16:00.000Z',
        to: '2026-11-18T05:21:00.000Z',
      },
    ],
  },
];

describe('foldAuditFeed', () => {
  it('folds adjacent login records of one day into a run and keeps a lone login as a row', () => {
    expect(shape(foldAuditFeed(RECORDS, { foldLogins: true }))).toEqual(FOLDED);
  });

  it('returns the same runs for every input order', () => {
    const orders = [
      [...RECORDS].reverse(),
      [...RECORDS.slice(4), ...RECORDS.slice(0, 4)],
      RECORDS.filter((_, index) => index % 2 === 0).concat(
        RECORDS.filter((_, index) => index % 2 === 1),
      ),
      [...RECORDS].sort((left, right) => left.id.localeCompare(right.id)),
    ];

    for (const order of orders) {
      expect(shape(foldAuditFeed(order, { foldLogins: true }))).toEqual(FOLDED);
    }
  });

  it('returns equal output when called again with the same input', () => {
    expect(foldAuditFeed(RECORDS, { foldLogins: true })).toEqual(
      foldAuditFeed(RECORDS, { foldLogins: true }),
    );
  });

  it('ends a run at the Asia/Seoul day boundary', () => {
    const days = foldAuditFeed(
      [
        login('after-2', '2026-11-18T15:00:01.000Z'),
        login('after-1', '2026-11-18T15:00:00.000Z'),
        login('before-2', '2026-11-18T14:59:59.999Z'),
        login('before-1', '2026-11-18T14:59:58.000Z'),
      ],
      { foldLogins: true },
    );

    expect(shape(days)).toEqual([
      {
        day: '2026-11-19',
        items: [
          {
            run: 'run:after-1',
            ids: ['after-2', 'after-1'],
            failures: 0,
            from: '2026-11-18T15:00:00.000Z',
            to: '2026-11-18T15:00:01.000Z',
          },
        ],
      },
      {
        day: '2026-11-18',
        items: [
          {
            run: 'run:before-1',
            ids: ['before-2', 'before-1'],
            failures: 0,
            from: '2026-11-18T14:59:58.000Z',
            to: '2026-11-18T14:59:59.999Z',
          },
        ],
      },
    ]);
  });

  it('ends a run when the next login is more than an hour older', () => {
    const days = foldAuditFeed(
      [
        login('n3', '2026-11-19T04:00:00.000Z'),
        login('n2', '2026-11-19T03:00:00.000Z'),
        login('n1', '2026-11-19T01:59:59.999Z'),
        login('n0', '2026-11-19T00:00:00.000Z'),
      ],
      { foldLogins: true },
    );

    expect(shape(days)).toEqual([
      {
        day: '2026-11-19',
        items: [
          {
            run: 'run:n2',
            ids: ['n3', 'n2'],
            failures: 0,
            from: '2026-11-19T03:00:00.000Z',
            to: '2026-11-19T04:00:00.000Z',
          },
          { event: 'n1' },
          { event: 'n0' },
        ],
      },
    ]);
  });

  it('breaks records that share one timestamp by id', () => {
    const at = '2026-11-19T04:00:00.000Z';
    const tied = [
      login('b', at),
      change('d', at),
      login('a', at),
      login('c', at),
    ];

    expect(shape(foldAuditFeed(tied, { foldLogins: true }))).toEqual([
      {
        day: '2026-11-19',
        items: [
          { event: 'd' },
          { run: 'run:a', ids: ['c', 'b', 'a'], failures: 0, from: at, to: at },
        ],
      },
    ]);
  });

  it('counts a repeated record once', () => {
    const days = foldAuditFeed([...RECORDS, RECORDS[0], RECORDS[3]], {
      foldLogins: true,
    });

    expect(shape(days)).toEqual(FOLDED);
  });

  it('keeps every record as its own row when folding is off', () => {
    const days = foldAuditFeed(RECORDS, { foldLogins: false });

    expect(days.flatMap((day) => day.items.map((item) => item.kind))).toEqual(
      RECORDS.map(() => 'event'),
    );
    expect(days.flatMap((day) => day.items.map((item) => item.key))).toEqual(
      RECORDS.map((record) => record.id),
    );
  });
});
