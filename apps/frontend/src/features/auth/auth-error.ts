export const AUTH_ERROR_MESSAGE =
  '로그인 요청을 완료하지 못했습니다. 다시 시도해 주세요.';

export type SearchParamsInput =
  | string
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | undefined;

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
