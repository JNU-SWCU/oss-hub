import { describe, expect, it } from 'vitest';
import { hasAuthError } from './auth-error';
import {
  LOGOUT_COMPLETE_PATH,
  LOGOUT_DEFAULT_RETURN_TO,
  LOGOUT_NOTICE_PARAM,
  LOGOUT_RETURN_TO_PARAM,
  hasLogoutNotice,
  logoutCompletePath,
  resolveLogoutReturnTo,
} from './logout-notice';

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

  // 로그아웃 안내와 로그인 실패는 서로 다른 표식이며 섞이면 안 된다 —
  // 로그아웃했는데 오류가 뜨거나 그 반대가 되면 사용자가 상태를 오해한다.
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

describe('resolveLogoutReturnTo', () => {
  it('복귀 주소가 없으면 로그인 진입으로 되돌린다', () => {
    expect(resolveLogoutReturnTo(undefined)).toBe(LOGOUT_DEFAULT_RETURN_TO);
    expect(resolveLogoutReturnTo('')).toBe(LOGOUT_DEFAULT_RETURN_TO);
  });

  it.each([
    ['문자열', `${LOGOUT_RETURN_TO_PARAM}=%2Franking`],
    [
      'URLSearchParams',
      new URLSearchParams({ [LOGOUT_RETURN_TO_PARAM]: '/ranking' }),
    ],
    ['객체', { [LOGOUT_RETURN_TO_PARAM]: '/ranking' }],
  ])('%s 입력에서 내부 경로를 그대로 쓴다', (_label, input) => {
    expect(resolveLogoutReturnTo(input)).toBe('/ranking');
  });

  /**
   * 이 화면은 방금 계정을 다루던 사람에게 "다시 로그인" 링크를 내민다. 그 링크의
   * 목적지를 주소창이 정할 수 있으면 우리 도메인에서 출발해 남의 로그인 화면에
   * 착지하는 open redirect가 그대로 열린다 — 사용자는 그 링크를 의심하지 않는다.
   */
  it.each([
    ['절대 URL', `${LOGOUT_RETURN_TO_PARAM}=https%3A%2F%2Fevil.example`],
    ['프로토콜 상대 URL', `${LOGOUT_RETURN_TO_PARAM}=%2F%2Fevil.example`],
    ['역슬래시 우회', `${LOGOUT_RETURN_TO_PARAM}=%2F%5Cevil.example`],
    ['javascript 스킴', `${LOGOUT_RETURN_TO_PARAM}=javascript%3Aalert(1)`],
    ['호스트만 적은 값', `${LOGOUT_RETURN_TO_PARAM}=evil.example`],
  ])('%s는 거부하고 기본 복귀 주소로 되돌린다', (_label, input) => {
    expect(resolveLogoutReturnTo(input)).toBe(LOGOUT_DEFAULT_RETURN_TO);
  });

  // 검사받은 값 뒤에 하나를 더 매달아 판정을 덮어쓰는 우회를 막는다.
  it('같은 키가 반복되면 첫 값만 본다', () => {
    const input = `${LOGOUT_RETURN_TO_PARAM}=%2Franking&${LOGOUT_RETURN_TO_PARAM}=https%3A%2F%2Fevil.example`;

    expect(resolveLogoutReturnTo(input)).toBe('/ranking');
  });

  it('객체 입력에서 배열로 온 값도 첫 값만 본다', () => {
    const input = {
      [LOGOUT_RETURN_TO_PARAM]: ['/ranking', 'https://evil.example'],
    };

    expect(resolveLogoutReturnTo(input)).toBe('/ranking');
  });
});

describe('logoutCompletePath', () => {
  it('복귀 주소가 기본값과 같으면 파라미터를 붙이지 않는다', () => {
    expect(logoutCompletePath()).toBe(LOGOUT_COMPLETE_PATH);
    expect(logoutCompletePath(LOGOUT_DEFAULT_RETURN_TO)).toBe(
      LOGOUT_COMPLETE_PATH,
    );
  });

  it('내부 경로는 파라미터로 실어 보내고 다시 읽으면 같은 값이 나온다', () => {
    const path = logoutCompletePath('/ranking');

    expect(path).toBe(
      `${LOGOUT_COMPLETE_PATH}?${LOGOUT_RETURN_TO_PARAM}=%2Franking`,
    );
    expect(resolveLogoutReturnTo(path.split('?')[1])).toBe('/ranking');
  });

  it.each([
    ['절대 URL', 'https://evil.example'],
    ['프로토콜 상대 URL', '//evil.example'],
    ['역슬래시 우회', '/\\evil.example'],
  ])('%s는 주소를 만드는 단계에서 이미 떨어뜨린다', (_label, input) => {
    expect(logoutCompletePath(input)).toBe(LOGOUT_COMPLETE_PATH);
  });
});
