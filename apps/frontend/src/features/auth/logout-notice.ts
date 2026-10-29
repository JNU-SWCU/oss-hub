import { hasSearchParam, type SearchParamsInput } from './auth-error';

export const LOGOUT_NOTICE_PARAM = 'loggedOut';
export const LOGOUT_NOTICE_MESSAGE = '로그아웃되었습니다.';
export const ACCOUNT_SWITCH_LINK_ID = 'landing-account-switch';

export function hasLogoutNotice(searchParams: SearchParamsInput): boolean {
  return hasSearchParam(searchParams, LOGOUT_NOTICE_PARAM);
}
