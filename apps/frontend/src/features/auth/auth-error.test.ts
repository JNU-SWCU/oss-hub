import { describe, expect, it } from 'vitest';
import {
  AUTH_ERROR_MESSAGE,
  hasAuthError,
  readSearchParam,
} from './auth-error';

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

describe('readSearchParam', () => {
  it.each([
    ['문자열', '?returnTo=%2Franking'],
    ['URLSearchParams', new URLSearchParams({ returnTo: '/ranking' })],
    ['객체', { returnTo: '/ranking' }],
  ])('%s 입력에서 같은 값을 읽는다', (_label, input) => {
    expect(readSearchParam(input, 'returnTo')).toBe('/ranking');
  });

  it.each([
    ['빈 입력', undefined],
    ['다른 키만 있는 문자열', 'authError=1'],
    ['빈 객체', {}],
  ])('%s에서는 null', (_label, input) => {
    expect(readSearchParam(input, 'returnTo')).toBeNull();
  });

  // 뒤에 붙인 값이 이기면 검사받은 앞의 값을 덮어쓰는 우회가 열린다.
  it('같은 키가 반복되면 세 입력 형태 모두 첫 값을 준다', () => {
    const query = 'returnTo=%2Franking&returnTo=%2Fadmin';

    expect(readSearchParam(query, 'returnTo')).toBe('/ranking');
    expect(readSearchParam(new URLSearchParams(query), 'returnTo')).toBe(
      '/ranking',
    );
    expect(
      readSearchParam({ returnTo: ['/ranking', '/admin'] }, 'returnTo'),
    ).toBe('/ranking');
  });

  // 값을 넣은 적 없는 자리에서 프로토타입의 무언가가 나오면 안 된다.
  it('객체 입력에서 프로토타입 체인을 타지 않는다', () => {
    expect(readSearchParam({}, 'constructor')).toBeNull();
    expect(readSearchParam({}, 'toString')).toBeNull();
  });
});
