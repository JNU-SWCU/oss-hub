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

/**
 * 내부 경로라고 해서 다 돌아갈 자리는 아니다. 이 목록이 없으면 로그아웃 화면에서
 * 로그아웃한 사람은 자기 자신으로 돌아오는 링크를(눌러도 제자리) 받고, 가입 절차
 * 중간에서 로그아웃한 사람은 앞 단계를 잃은 채 절차 한가운데로 되돌려진다.
 */
describe('복귀 주소로 삼지 않는 자리', () => {
  it.each([
    ['로그아웃 화면 자신', LOGOUT_COMPLETE_PATH],
    ['가입 입구', '/signup'],
    ['약관 동의', '/consent'],
    ['역할 선택', '/onboarding/role'],
    ['프로필 입력', '/onboarding/profile'],
    ['승인 대기', '/onboarding/pending'],
  ])('%s는 주소를 만들 때 기본값으로 떨어진다', (_label, input) => {
    expect(logoutCompletePath(input)).toBe(LOGOUT_COMPLETE_PATH);
  });

  // 만드는 쪽만 막으면 주소창에 손으로 적어 넣은 값이 검사를 비켜 간다.
  it.each([
    ['로그아웃 화면 자신', LOGOUT_COMPLETE_PATH],
    ['약관 동의', '/consent'],
    ['역할 선택', '/onboarding/role'],
  ])('%s는 주소를 읽을 때도 기본값으로 떨어진다', (_label, input) => {
    const query = new URLSearchParams({ [LOGOUT_RETURN_TO_PARAM]: input });

    expect(resolveLogoutReturnTo(query.toString())).toBe(
      LOGOUT_DEFAULT_RETURN_TO,
    );
  });

  // 경계는 세그먼트다 — 이름만 겹치는 다른 화면까지 함께 막으면 멀쩡한 복귀가 끊긴다.
  it.each([
    ['가입 안내', '/signup-guide'],
    ['온보딩과 이름만 겹치는 화면', '/onboarding-faq'],
    ['로그아웃과 이름만 겹치는 화면', '/logout-help'],
  ])('%s는 그대로 복귀 주소가 된다', (_label, input) => {
    expect(logoutCompletePath(input)).toBe(
      `${LOGOUT_COMPLETE_PATH}?${LOGOUT_RETURN_TO_PARAM}=${encodeURIComponent(input)}`,
    );
  });

  /**
   * 복귀 주소는 경로만 싣는다. 이 값은 주소창에 남아 복사·공유되고 서버 로그에도
   * 남는데, 쿼리에는 화면 상태만이 아니라 식별자가 실릴 수 있다. 경로만으로도
   * 있던 화면은 되찾히므로 값을 좁게 받는다. 해시는 서버에 가지도 않는다.
   */
  it.each([
    ['쿼리', '/dashboard/users?userId=42'],
    ['해시', '/programs/1#team-7'],
    ['쿼리로 위장한 자기 참조', `${LOGOUT_COMPLETE_PATH}?x=1`],
  ])('%s가 붙은 값은 싣지 않는다', (_label, input) => {
    expect(logoutCompletePath(input)).toBe(LOGOUT_COMPLETE_PATH);
  });
});
