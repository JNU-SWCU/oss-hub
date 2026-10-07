import { describe, expect, it } from 'vitest';
import { hasAuthError } from './auth-error';
import { LOGOUT_NOTICE_PARAM, hasLogoutNotice } from './logout-notice';

describe('hasLogoutNotice', () => {
  it.each([
    ['문자열', `${LOGOUT_NOTICE_PARAM}=1`],
    ['URLSearchParams', new URLSearchParams(`${LOGOUT_NOTICE_PARAM}=1`)],
    ['객체', { [LOGOUT_NOTICE_PARAM]: '1' }],
  ])('%s 입력에서 표식을 인식한다', (_label, input) => {
    expect(hasLogoutNotice(input)).toBe(true);
  });

  it.each([
    ['빈 입력', undefined],
    ['다른 표식만 있는 문자열', 'authError=1'],
    ['빈 객체', {}],
  ])('%s 에서는 안내를 띄우지 않는다', (_label, input) => {
    expect(hasLogoutNotice(input)).toBe(false);
  });

  it('로그인 실패 표식과 서로 섞이지 않는다', () => {
    expect(hasLogoutNotice('authError=1')).toBe(false);
    expect(hasAuthError(`${LOGOUT_NOTICE_PARAM}=1`)).toBe(false);
  });

  it('두 표식이 함께 오면 둘 다 인식한다', () => {
    const input = `authError=1&${LOGOUT_NOTICE_PARAM}=1`;

    expect(hasAuthError(input)).toBe(true);
    expect(hasLogoutNotice(input)).toBe(true);
  });
});
