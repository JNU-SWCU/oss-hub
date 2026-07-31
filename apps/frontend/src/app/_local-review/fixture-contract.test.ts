import { describe, expect, it } from 'vitest';
import {
  createLocalReviewActivation,
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
