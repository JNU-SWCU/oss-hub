// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  loginDestination,
  rememberLoginDestination,
  signupForDestination,
  takeLoginDestination,
} from './login-destination';

describe('로그인 후 원래 화면으로 돌아가기', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  it('원래 업무 경로는 한 번만 복귀한다', () => {
    expect(signupForDestination('/programs/42/apply')).toBe(
      '/signup?returnTo=%2Fprograms%2F42%2Fapply',
    );
    rememberLoginDestination(sessionStorage, '/programs/42/apply', 0);
    expect(takeLoginDestination(sessionStorage, 1)).toBe('/programs/42/apply');
    expect(takeLoginDestination(sessionStorage, 2)).toBeNull();
  });
  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    apiPath('auth/logout'),
    '/signup',
    '/consent',
    '/onboarding/profile',
    '/%2f%2fevil.example',
    '/programs?token=x',
    '/programs#x',
  ])('외부·절차·쿼리 경로 %s는 저장하지 않는다', (value) => {
    expect(loginDestination(value)).toBeNull();
    rememberLoginDestination(sessionStorage, value, 0);
    expect(takeLoginDestination(sessionStorage, 1)).toBeNull();
  });
  it('지난 로그인 목적지나 깨진 값은 소비 후 버린다', () => {
    rememberLoginDestination(sessionStorage, '/ranking', 0);
    expect(takeLoginDestination(sessionStorage, 600001)).toBeNull();
    sessionStorage.setItem('oss-hub-login-destination', '{');
    expect(takeLoginDestination(sessionStorage, 1)).toBeNull();
  });
  it.each([
    '/auth/github',
    '/x/../api/v1/auth/logout',
    '/./consent',
    '/API/v1/auth/github',
    '/onboarding/../auth/github',
    '/programs\u0000',
  ])('인증 또는 정규화 우회 경로 %s를 거절한다', (value) => {
    expect(loginDestination(value)).toBeNull();
  });
  it('정확히 10분이 지나면 만료하고 조작된 먼 미래 만료값도 버린다', () => {
    rememberLoginDestination(sessionStorage, '/ranking', 0);
    expect(takeLoginDestination(sessionStorage, 600000)).toBeNull();
    sessionStorage.setItem(
      'oss-hub-login-destination',
      JSON.stringify({ destination: '/ranking', expiresAt: 999999999 }),
    );
    expect(takeLoginDestination(sessionStorage, 0)).toBeNull();
    expect(takeLoginDestination(sessionStorage, 0)).toBeNull();
  });
  it('목적지 없는 로그인 재시도는 기존 목적지와 최초 만료 시각을 유지한다', () => {
    rememberLoginDestination(sessionStorage, '/ranking', 0);
    rememberLoginDestination(sessionStorage, null, 300000);
    expect(takeLoginDestination(sessionStorage, 300001)).toBe('/ranking');
    rememberLoginDestination(sessionStorage, '/ranking', 0);
    rememberLoginDestination(sessionStorage, null, 300000);
    expect(takeLoginDestination(sessionStorage, 600000)).toBeNull();
  });
  it.each(['getItem', 'removeItem'] as const)(
    '저장소 %s 실패 시 복귀하지 않는다',
    (method) => {
      const storage = sessionStorage;
      rememberLoginDestination(storage, '/ranking');
      vi.spyOn(storage, method).mockImplementation(() => {
        throw new DOMException('Storage blocked', 'SecurityError');
      });
      expect(takeLoginDestination(storage)).toBeNull();
    },
  );
  it('저장소 쓰기가 실패해도 로그인 처리를 막지 않는다', () => {
    const storage = sessionStorage;
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(() => rememberLoginDestination(storage, '/ranking')).not.toThrow();
  });
});
