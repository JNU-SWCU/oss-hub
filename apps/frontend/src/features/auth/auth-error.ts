export const AUTH_ERROR_MESSAGE =
  '로그인 요청을 완료하지 못했습니다. 다시 시도해 주세요.';

export type SearchParamsInput =
  | string
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | undefined;

/**
 * searchParams의 세 입력 형태(문자열·URLSearchParams·객체)를 한 번에 다룬다.
 * 로그인 실패와 로그아웃 안내가 같은 판정 규칙을 공유하도록 분리했다 —
 * 형태별 분기를 모듈마다 따로 구현하면 한쪽만 고쳐지는 드리프트가 생긴다.
 */
export function hasSearchParam(
  searchParams: SearchParamsInput,
  key: string,
): boolean {
  if (!searchParams) {
    return false;
  }

  if (typeof searchParams === 'string') {
    return new URLSearchParams(searchParams).has(key);
  }

  if (searchParams instanceof URLSearchParams) {
    return searchParams.has(key);
  }

  return Object.prototype.hasOwnProperty.call(searchParams, key);
}

export function hasAuthError(searchParams: SearchParamsInput): boolean {
  return hasSearchParam(searchParams, 'authError');
}
