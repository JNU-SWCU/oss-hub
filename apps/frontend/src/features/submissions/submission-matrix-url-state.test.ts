import { describe, expect, it } from 'vitest';
import { MATRIX_DEFAULT_ORDER, type MatrixQueryInput } from './matrix';
import {
  buildSubmissionMatrixSearchParams,
  parseSubmissionMatrixSearchParams,
} from './submission-matrix-url-state';

const defaults: MatrixQueryInput = {
  q: '',
  page: 1,
  pageSize: 20,
  ...MATRIX_DEFAULT_ORDER,
};

describe('SubmissionMatrix URL state', () => {
  it('resolves invalid pages and obsolete statuses without putting them back in the URL', () => {
    const params = new URLSearchParams('page=abc&status=OVERDUE');
    const state = parseSubmissionMatrixSearchParams(params);

    expect(state).toEqual({
      q: '',
      page: 1,
      pageSize: 20,
      sort: 'team',
      direction: 'asc',
    });
    expect(buildSubmissionMatrixSearchParams(state).toString()).toBe('');
  });

  it('reads search and status without treating route-level milestoneId as a matrix filter', () => {
    const input = new URLSearchParams(
      'q=++홍길동++&status=REJECTED&milestoneId=plan&page=2',
    );
    const state = parseSubmissionMatrixSearchParams(input);

    expect(state).toEqual({
      ...defaults,
      q: '홍길동',
      page: 2,
      status: 'REJECTED',
    });
    expect([...buildSubmissionMatrixSearchParams(state)]).toEqual([
      ['q', '홍길동'],
      ['page', '2'],
      ['status', 'REJECTED'],
    ]);
  });

  it.each([
    'NOT_SUBMITTED',
    'SUBMITTED',
    'CHANGES_REQUESTED',
    'APPROVED',
    'REJECTED',
  ] as const)(
    'round trips document status %s alongside a milestone order and page',
    (status) => {
      const state: MatrixQueryInput = {
        ...defaults,
        q: 'x y',
        page: 3,
        status,
        sort: 'milestone:plan/2',
        direction: 'desc',
      };
      const params = buildSubmissionMatrixSearchParams(state);
      expect(params.toString()).toBe(
        `q=x+y&page=3&status=${status}&sort=milestone%3Aplan%2F2&direction=desc`,
      );
      expect(parseSubmissionMatrixSearchParams(params)).toEqual(state);
    },
  );

  it.each([
    ['team', 'desc'],
    ['progress', 'asc'],
  ] as const)(
    'keeps both order fields when the selected pair is %s %s',
    (sort, direction) => {
      const params = buildSubmissionMatrixSearchParams({
        ...defaults,
        sort,
        direction,
      });
      expect(params.toString()).toBe(`sort=${sort}&direction=${direction}`);
      expect(parseSubmissionMatrixSearchParams(params)).toEqual({
        ...defaults,
        sort,
        direction,
      });
    },
  );

  it.each([
    'sort=progress',
    'direction=desc',
    'sort=bogus&direction=desc',
    'sort=progress&direction=up',
    'sort=milestone%3A&direction=desc',
    'sort=milestone%3Aplan+2&direction=asc',
    'sort=milestone%3Aplan%0A&direction=desc',
  ])(
    'discards the entire incomplete or invalid order %s without losing valid status',
    (query) => {
      const state = parseSubmissionMatrixSearchParams(
        new URLSearchParams(`${query}&status=APPROVED`),
      );
      expect(state).toEqual({ ...defaults, status: 'APPROVED' });
      expect(buildSubmissionMatrixSearchParams(state).toString()).toBe(
        'status=APPROVED',
      );
    },
  );

  it.each(['ALL', 'LATE', 'OVERDUE', 'constructor'])(
    'does not recognize %s as a document status',
    (status) => {
      const state = parseSubmissionMatrixSearchParams(
        new URLSearchParams({ status, quickFilter: 'REJECTED' }),
      );
      expect(state.status).toBeUndefined();
    },
  );
});
