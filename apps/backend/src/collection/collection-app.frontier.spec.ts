import {
  RequestFingerprint,
  requestFingerprintKey,
} from './collection-app.frontier';

const base: RequestFingerprint = {
  endpoint: '/repos/o/r/releases',
  ref: null,
  query: 'per_page=1',
  order: null,
  pageSize: 1,
  accept: 'application/vnd.github+json',
  apiVersion: '2022-11-28',
};

describe('requestFingerprintKey', () => {
  it('produces identical keys for identical fingerprints', () => {
    expect(requestFingerprintKey(base)).toEqual(
      requestFingerprintKey({ ...base }),
    );
  });

  it.each([
    ['query', { ...base, query: 'per_page=100' }],
    ['pageSize', { ...base, pageSize: 100 }],
    ['ref', { ...base, ref: 'main' }],
    ['order', { ...base, order: 'sort=created&direction=desc' }],
    ['endpoint', { ...base, endpoint: '/repos/o/r/commits' }],
    ['accept', { ...base, accept: 'application/json' }],
    ['apiVersion', { ...base, apiVersion: '2020-01-01' }],
  ] as const)(
    'differs when %s differs so an ETag is never shared across fingerprints',
    (_field, changed) => {
      expect(requestFingerprintKey(changed)).not.toEqual(
        requestFingerprintKey(base),
      );
    },
  );

  it('never embeds a NUL byte (Postgres text columns reject 0x00 unconditionally)', () => {
    expect(requestFingerprintKey(base)).not.toContain('\u0000');
  });

  it('does not collide when a field boundary shifts (separator injection safety)', () => {
    // Naive concatenation (no separator, or a separator that can appear inside
    // a field value) would let `endpoint + ref` collide across a boundary
    // shift, e.g. ("ab", "c") vs ("a", "bc"). The unit-separator (U+001F) join
    // must keep these distinct because it cannot appear in any field value we
    // populate fingerprints with (endpoint paths, refs, queries, etc. are all
    // ASCII-safe GitHub API inputs).
    const shiftedLeft: RequestFingerprint = {
      ...base,
      endpoint: '/repos/o/rab',
      ref: 'c',
    };
    const shiftedRight: RequestFingerprint = {
      ...base,
      endpoint: '/repos/o/ra',
      ref: 'bc',
    };
    expect(requestFingerprintKey(shiftedLeft)).not.toEqual(
      requestFingerprintKey(shiftedRight),
    );
  });
});
