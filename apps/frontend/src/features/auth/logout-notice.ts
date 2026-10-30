import { hasSearchParam, type SearchParamsInput } from './auth-error';

export const LOGOUT_NOTICE_PARAM = 'loggedOut';

export function hasLogoutNotice(searchParams: SearchParamsInput): boolean {
  return hasSearchParam(searchParams, LOGOUT_NOTICE_PARAM);
}
