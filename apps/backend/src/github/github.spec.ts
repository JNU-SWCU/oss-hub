import {
  CollectionAppClient,
  RequestFingerprint,
} from './collection-app.client';
import type { CollectionAppConfigValues } from './collection-app.config';

const client = new CollectionAppClient({} as CollectionAppConfigValues, {
  getToken: () => Promise.resolve('synthetic-token'),
  clear: () => undefined,
});

describe('collection-app-frontier', () => {
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
      expect(client.requestFingerprintKey(base)).toEqual(
        client.requestFingerprintKey({ ...base }),
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
        expect(client.requestFingerprintKey(changed)).not.toEqual(
          client.requestFingerprintKey(base),
        );
      },
    );

    it('never embeds a NUL byte (Postgres text columns reject 0x00 unconditionally)', () => {
      expect(client.requestFingerprintKey(base)).not.toContain('\u0000');
    });

    it('does not collide when a field boundary shifts (separator injection safety)', () => {
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
      expect(client.requestFingerprintKey(shiftedLeft)).not.toEqual(
        client.requestFingerprintKey(shiftedRight),
      );
    });
  });
});
