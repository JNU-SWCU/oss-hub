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
        ids: ['l5', 'l4', 'l3'],
        failures: 1,
        from: '2026-11-19T04:51:00.000Z',
        to: '2026-11-19T04:58:00.000Z',
      },
      { event: 'c2' },
      {
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

  it('keeps an intervening grant with a colliding ID in either input order', () => {
    const fixture = AUDIT_LOG_PAGE_RESPONSE_FIXTURE;
    const { items } = parseAuditLogPage({
      ...fixture,
      total: 3,
      counts: { ACCOUNT: 0, OPERATION: 0, SUBMISSION: 0, LOGIN: 2, SYSTEM: 1 },
      items: [
        {
          ...fixture.items[4],
          id: 'shared',
          occurredAt: '2026-11-19T04:35:00.000Z',
        },
        {
          ...fixture.items[3],
          id: 'shared',
          occurredAt: '2026-11-19T04:30:00.000Z',
        },
        {
          ...fixture.items[4],
          action: 'LOGIN_FAILED',
          occurredAt: '2026-11-19T04:25:00.000Z',
        },
      ],
    });

    for (const order of [items, [...items].reverse()]) {
      const [day] = foldAuditFeed(order, { foldLogins: true });

      expect(day.items).toMatchObject([
        { kind: 'event', record: { id: 'shared', action: 'LOGIN' } },
        {
          kind: 'event',
          record: { id: 'shared', action: 'GRANT_ADMIN_ACCESS' },
        },
        { kind: 'event', record: { action: 'LOGIN_FAILED' } },
      ]);
      expect(new Set(day.items.map((item) => item.key)).size).toBe(3);
    }
  });

  it('separates runs at the Asia/Seoul day boundary even if their anchors share an ID', () => {
    const days = foldAuditFeed(
      [
        login('after-2', '2026-11-18T15:00:01.000Z'),
        login('shared', '2026-11-18T15:00:00.000Z'),
        login('before-2', '2026-11-18T14:59:59.999Z'),
        login('shared', '2026-11-18T14:59:58.000Z'),
      ],
      { foldLogins: true },
    );

    expect(shape(days)).toEqual([
      {
        day: '2026-11-19',
        items: [
          {
            ids: ['after-2', 'shared'],
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
            ids: ['before-2', 'shared'],
            failures: 0,
            from: '2026-11-18T14:59:58.000Z',
            to: '2026-11-18T14:59:59.999Z',
          },
        ],
      },
    ]);
    expect(days[0].items[0].key).not.toBe(days[1].items[0].key);
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
          { ids: ['c', 'b', 'a'], failures: 0, from: at, to: at },
        ],
      },
    ]);
  });

  it('orders same-time, same-ID records by payload and counts equivalent copies once', () => {
    const first = login('shared', '2026-11-19T04:00:00.000Z');
    const second = { ...first, target: { ...first.target, id: 'user-z' } };
    const { id, ...target } = first.target;
    const copy = { ...first, target: { id, ...target } };
    const records = [first, copy, second];
    const days = foldAuditFeed(records, { foldLogins: true });

    expect(days[0].items).toMatchObject([
      { kind: 'run', records: [second, first], failures: 0 },
    ]);
    expect(foldAuditFeed([...records].reverse(), { foldLogins: true })).toEqual(
      days,
    );
  });

  it.each([
    ['LOGOUT_FAILED', 'LOGIN'],
    ['OTHER_LOGIN_ACTION', 'LOGIN'],
    ['LOGIN', 'SYSTEM'],
  ] as const)(
    'keeps %s (%s) as a barrier between logins',
    (action, category) => {
      const records = [
        login('newer', '2026-11-19T04:35:00.000Z'),
        { ...login('barrier', '2026-11-19T04:30:00.000Z', action), category },
        login('older', '2026-11-19T04:25:00.000Z', 'LOGIN_FAILED'),
      ];

      expect(shape(foldAuditFeed(records, { foldLogins: true }))).toEqual([
        {
          day: '2026-11-19',
          items: [{ event: 'newer' }, { event: 'barrier' }, { event: 'older' }],
        },
      ]);
    },
  );

  it('counts a repeated record once', () => {
    const days = foldAuditFeed([...RECORDS, RECORDS[0], RECORDS[3]], {
      foldLogins: true,
    });

    expect(shape(days)).toEqual(FOLDED);
  });

  it('keeps every record as its own row when folding is off', () => {
    const days = foldAuditFeed(RECORDS, { foldLogins: false });

    expect(days.flatMap((day) => day.items)).toMatchObject(
      RECORDS.map((record) => ({ kind: 'event', record })),
    );
  });
});
