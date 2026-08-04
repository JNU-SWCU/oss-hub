import { describe, expect, it } from 'vitest';
import {
  LOCAL_REVIEW_FIXTURE_IDS,
  LOCAL_REVIEW_FIXTURE_PATTERN,
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
  it('routes every known fixture cookie to the adapter', () => {
    // Given: next.config의 쿠키 조건은 이 패턴을 `^…$`로 감싸 완전 일치로 본다.
    const cookieMatcher = new RegExp(`^${LOCAL_REVIEW_FIXTURE_PATTERN}$`);

    // When / Then: 패턴에서 빠진 페르소나는 쿠키가 있어도 어댑터 대신 실제
    // backend로 새어 나가, 검토자에게는 "그 페르소나만 계속 오류"로 보인다.
    for (const fixture of LOCAL_REVIEW_FIXTURE_IDS) {
      expect(cookieMatcher.test(fixture)).toBe(true);
    }
    expect(cookieMatcher.test('error-once-extra')).toBe(false);
  });

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

  // 가입·로그인 진입은 비로그인 방문자가 보는 화면이라, 검토도 `anonymous`
  // 페르소나로 열려야 한다. 허용 목록에서 빠지면 `to=/signup`이 조용히 랜딩으로
  // 떨어져 아무도 이 화면을 못 본다.
  it('opens the signup entry for the anonymous persona', () => {
    // Given / When
    const activation = createLocalReviewActivation({
      ...LOCAL_INPUT,
      fixtureParam: 'anonymous',
      targetParam: '/signup',
    });

    // Then
    expect(activation).toEqual({
      kind: 'redirect',
      fixture: 'anonymous',
      target: '/signup',
    });
  });

  it.each(['/', '/programs', '/archive'] as const)(
    'keeps the public shell route %s reachable as a fixture destination',
    (target) => {
      // Given / When
      const activation = createLocalReviewActivation({
        ...LOCAL_INPUT,
        fixtureParam: 'student',
        targetParam: target,
      });

      // Then
      expect(activation).toEqual({
        kind: 'redirect',
        fixture: 'student',
        target,
      });
    },
  );

  it.each([
    '/programs/program-capstone',
    '/programs/program-capstone/apply',
    '/programs/program-capstone/teams',
    '/programs/',
    '/archive/repository-1',
    '/programs/program-capstone/applicants',
    '/dashboard/activity',
    '/onboarding/pending',
    '/profile/synthetic-user-01',
  ])('reaches the in-app detail destination %j through a prefix', (target) => {
    // Given / When: 상세 화면은 id가 열려 있어 완전 일치 목록으로 적을 수 없다.
    const activation = createLocalReviewActivation({
      ...LOCAL_INPUT,
      fixtureParam: 'student',
      targetParam: target,
    });

    // Then
    expect(activation).toEqual({
      kind: 'redirect',
      fixture: 'student',
      target,
    });
  });

  it.each([
    '/admin/console',
    '//evil.com',
    'https://evil.com',
    'http://localhost:3000/programs',
    '/programs?next=https://evil.com',
    '',
    // 접두사 허용이 생겨도 아래 표기는 앱 밖으로 나갈 수 있어 계속 막는다.
    '\\\\evil.com',
    '/\\evil.com',
    '/programs/\\evil.com',
    '//evil.com/programs/',
    '\n/programs/program-capstone',
    '/programs/\r\nSet-Cookie: a=b',
    '/programs/\u0000',
    'programs/program-capstone',
  ])('never redirects to the non-allowlisted destination %j', (target) => {
    // Given / When
    const activation = createLocalReviewActivation({
      ...LOCAL_INPUT,
      fixtureParam: 'student',
      targetParam: target,
    });

    // Then: the allowlist exists to block open redirects, so anything outside
    // it falls back to the local root instead of leaving the app.
    expect(activation).toEqual({
      kind: 'redirect',
      fixture: 'student',
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
