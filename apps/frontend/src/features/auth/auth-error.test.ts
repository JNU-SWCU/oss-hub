import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_MESSAGE, hasAuthError } from './auth-error';

describe('auth error rendering', () => {
  it.each([
    '?authError=1&code=synthetic-code&state=synthetic-state',
    new URLSearchParams('authError=access_denied'),
    { authError: '1' },
  ])('authError 존재만 감지하고 값을 렌더링 대상으로 쓰지 않는다', (input) => {
    expect(hasAuthError(input)).toBe(true);
    expect(AUTH_ERROR_MESSAGE).not.toContain('synthetic-code');
    expect(AUTH_ERROR_MESSAGE).not.toContain('synthetic-state');
    expect(AUTH_ERROR_MESSAGE).not.toContain('access_denied');
  });

  it('authError가 없으면 false', () => {
    expect(hasAuthError('?code=synthetic-code&state=synthetic-state')).toBe(
      false,
    );
    expect(hasAuthError(undefined)).toBe(false);
  });
});
