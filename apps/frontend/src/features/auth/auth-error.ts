export const AUTH_ERROR_MESSAGE =
  "로그인 요청을 완료하지 못했습니다. 다시 시도해 주세요.";

export type SearchParamsInput =
  | string
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | undefined;

export function hasAuthError(searchParams: SearchParamsInput): boolean {
  if (!searchParams) {
    return false;
  }

  if (typeof searchParams === "string") {
    return new URLSearchParams(searchParams).has("authError");
  }

  if (searchParams instanceof URLSearchParams) {
    return searchParams.has("authError");
  }

  return Object.prototype.hasOwnProperty.call(searchParams, "authError");
}
