import { describe, expect, it } from 'vitest';
import {
  LOCAL_REVIEW_LOOPBACK_HOSTNAMES,
  LOCAL_REVIEW_LOOPBACK_HOST_PATTERN,
  createLocalReviewActivation,
  isLoopbackHostname,
  parseRequestHostname,
} from './fixture-contract';

const LOCAL_INPUT = {
  nodeEnv: 'development',
  enabled: '1',
  backendOrigin: 'http://localhost:4000',
  requestHostname: 'localhost',
} as const;

describe('local review activation contract', () => {
  it('parses the raw request Host header instead of trusting a normalized URL', () => {
    expect(parseRequestHostname('localhost:3000')).toBe('localhost');
    expect(parseRequestHostname('127.0.0.1:3000')).toBe('127.0.0.1');
    expect(parseRequestHostname('[::1]:3000')).toBe('[::1]');
    expect(parseRequestHostname('review.example.com')).toBe(
      'review.example.com',
    );
    expect(parseRequestHostname(null)).toBeNull();
    expect(parseRequestHostname('not a valid host')).toBeNull();
  });

  it('라우트의 host 허용 집합과 rewrite host 패턴이 정확히 같은 범위를 가리킨다', () => {
    // Given — next.config.ts의 rewrite `has` 규칙이 쓰는 정규식이다.
    const pattern = new RegExp(`^${LOCAL_REVIEW_LOOPBACK_HOST_PATTERN}$`);

    // When / Then — 허용 host는 양쪽 모두 통과해야 한다.
    for (const hostname of LOCAL_REVIEW_LOOPBACK_HOSTNAMES) {
      expect(isLoopbackHostname(hostname)).toBe(true);
      expect(pattern.test(hostname)).toBe(true);
    }

    // 지원 범위 밖 host는 양쪽 모두에서 막혀야 한다. IPv6 loopback은 Next의 host matcher가
    // Host 헤더를 ':'로 잘라 복원하지 못해 rewrite가 매치될 수 없으므로 지원하지 않는다.
    for (const hostname of [
      '::1',
      '[::1]',
      '127.0.0.11',
      'review.example.com',
    ]) {
      expect(isLoopbackHostname(hostname)).toBe(false);
      expect(pattern.test(hostname)).toBe(false);
    }
  });

  it('is unavailable in production even when the flag is set', () => {
    // Given / When
    const activation = createLocalReviewActivation({
      ...LOCAL_INPUT,
      nodeEnv: 'production',
      fixtureParam: 'student',
      targetParam: '/dashboard',
    });

    // Then
    expect(activation).toEqual({ kind: 'not-found' });
  });

  it('is unavailable without the explicit flag or on a non-loopback request', () => {
    // Given / When
    const disabled = createLocalReviewActivation({
      ...LOCAL_INPUT,
      enabled: undefined,
      fixtureParam: 'student',
      targetParam: '/dashboard',
    });
    const remote = createLocalReviewActivation({
      ...LOCAL_INPUT,
      requestHostname: 'review.example.com',
      fixtureParam: 'student',
      targetParam: '/dashboard',
    });

    // Then
    expect(disabled).toEqual({ kind: 'not-found' });
    expect(remote).toEqual({ kind: 'not-found' });
  });

  it('activates a known state and only an allowlisted local destination', () => {
    // Given / When
    const activation = createLocalReviewActivation({
      ...LOCAL_INPUT,
      fixtureParam: 'student',
      targetParam: '/dashboard',
    });
    const externalTarget = createLocalReviewActivation({
      ...LOCAL_INPUT,
      fixtureParam: 'admin',
      targetParam: 'https://example.com/',
    });

    // Then
    expect(activation).toEqual({
      kind: 'redirect',
      fixture: 'student',
      target: '/dashboard',
    });
    expect(externalTarget).toEqual({
      kind: 'redirect',
      fixture: 'admin',
      target: '/',
    });
  });

  it('rejects unknown fixture ids and supports clearing the fixture cookie', () => {
    // Given / When
    const unknown = createLocalReviewActivation({
      ...LOCAL_INPUT,
      fixtureParam: 'unknown',
      targetParam: '/',
    });
    const clear = createLocalReviewActivation({
      ...LOCAL_INPUT,
      fixtureParam: 'off',
      targetParam: '/',
    });

    // Then
    expect(unknown).toEqual({ kind: 'not-found' });
    expect(clear).toEqual({
      kind: 'redirect',
      fixture: null,
      target: '/',
    });
  });
});
