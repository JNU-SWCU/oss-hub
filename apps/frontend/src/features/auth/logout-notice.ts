import { hasSearchParam, type SearchParamsInput } from './auth-error';

/** 로그아웃 성공 후 랜딩으로 되돌릴 때 붙이는 표식. */
export const LOGOUT_NOTICE_PARAM = 'loggedOut';

/**
 * GitHub OAuth에는 계정 선택 화면을 강제하는 수단이 없다. 이 서비스에서
 * 로그아웃해도 GitHub 세션은 남아 있으므로, 다시 로그인을 누르면 계정 선택
 * 없이 같은 계정으로 즉시 되돌아온다. 사용자는 그것을 "로그아웃이 안 됐다"로
 * 읽는다 — 실제로는 성공했지만 결과가 예상과 다르기 때문이다.
 *
 * 그래서 로그아웃 자체를 알리는 것에서 멈추지 않고, 계정을 바꾸려면 무엇이
 * 더 필요한지까지 함께 알린다.
 */
export const LOGOUT_NOTICE_MESSAGE =
  '로그아웃되었습니다. 다른 계정으로 로그인하려면 GitHub에서도 로그아웃해야 합니다.';

/** GitHub 로그아웃 경로 — 계정 전환 안내에서 연결한다. */
export const GITHUB_LOGOUT_URL = 'https://github.com/logout';

export function hasLogoutNotice(searchParams: SearchParamsInput): boolean {
  return hasSearchParam(searchParams, LOGOUT_NOTICE_PARAM);
}
