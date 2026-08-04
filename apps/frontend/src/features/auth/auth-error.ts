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

/**
 * 표식의 유무가 아니라 **값**이 필요할 때 쓴다(로그아웃 복귀 주소 등).
 *
 * 같은 키가 여러 번 오면 첫 값만 본다. 뒤에 붙인 값이 이기는 규칙이면
 * `?returnTo=/signup&returnTo=https://evil.example`처럼 검사받은 앞의 값 뒤에
 * 하나를 더 매달아 판정을 덮어쓰는 우회가 생긴다 — `URLSearchParams.get`도
 * 첫 값을 주므로 세 입력 형태의 답이 서로 갈리지 않는다.
 */
export function readSearchParam(
  searchParams: SearchParamsInput,
  key: string,
): string | null {
  if (!searchParams) {
    return null;
  }

  if (typeof searchParams === 'string') {
    return new URLSearchParams(searchParams).get(key);
  }

  if (searchParams instanceof URLSearchParams) {
    return searchParams.get(key);
  }

  // 객체 형태는 프로토타입 체인을 타지 않는다 — `?constructor=...` 같은 키가
  // 값을 넣은 적 없는 자리에서 무언가를 꺼내 오면 안 된다.
  if (!Object.prototype.hasOwnProperty.call(searchParams, key)) {
    return null;
  }
  const value = searchParams[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export function hasAuthError(searchParams: SearchParamsInput): boolean {
  return hasSearchParam(searchParams, 'authError');
}
