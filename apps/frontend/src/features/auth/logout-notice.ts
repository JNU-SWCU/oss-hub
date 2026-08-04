import { toInternalPath } from '@/lib/internal-path';
import {
  hasSearchParam,
  readSearchParam,
  type SearchParamsInput,
} from './auth-error';
import { SIGNUP_ENTRY } from './signup-entry-link';

/** 로그아웃 성공 후 랜딩으로 되돌릴 때 붙이던 표식. */
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

/** GitHub 로그아웃 경로 — 계정 전환 왕복의 바깥쪽 구간이다. */
export const GITHUB_LOGOUT_URL = 'https://github.com/logout';

/**
 * 로그아웃 완료 화면.
 *
 * 안내를 `/?loggedOut=1`처럼 쿼리 표식으로만 두면 새로고침·뒤로가기·주소 정리
 * 한 번에 표식이 사라지고, 사용자는 계정을 바꾸려면 무엇이 더 필요한지 들을 자리를
 * 잃는다. 로그아웃은 그 자체로 하나의 결과이므로 자기 주소를 갖는다.
 */
export const LOGOUT_COMPLETE_PATH = '/logout';

/** 로그아웃 완료 화면이 읽는 복귀 주소 파라미터. */
export const LOGOUT_RETURN_TO_PARAM = 'returnTo';

/**
 * 왕복이 끝나고 돌아올 기본 주소.
 *
 * GitHub 로그아웃까지 마친 사람이 하려던 일은 대개 "다른 계정으로 들어오기"다.
 * 그 입구는 제품에 하나뿐이므로(`/signup`) 여기서 OAuth로 직행하지 않는다 —
 * 진입점이 둘인데 목적지가 갈라지는 것이 애초의 문제였다(signup-entry-link.ts).
 */
export const LOGOUT_DEFAULT_RETURN_TO = SIGNUP_ENTRY.href;

export function hasLogoutNotice(searchParams: SearchParamsInput): boolean {
  return hasSearchParam(searchParams, LOGOUT_NOTICE_PARAM);
}

/**
 * 로그아웃 완료 화면으로 가는 주소를 만든다.
 *
 * 복귀 주소가 기본값과 같으면 붙이지 않는다 — 주소창에 아무 의미 없는 파라미터가
 * 남으면 그것까지 복사돼 돌아다니고, 나중에 기본값을 바꿔도 옛 링크는 옛 값을
 * 계속 들고 다닌다.
 */
export function logoutCompletePath(returnTo?: unknown): string {
  const resolved = toInternalPath(returnTo, LOGOUT_DEFAULT_RETURN_TO);
  if (resolved === LOGOUT_DEFAULT_RETURN_TO) {
    return LOGOUT_COMPLETE_PATH;
  }
  const query = new URLSearchParams({ [LOGOUT_RETURN_TO_PARAM]: resolved });
  return `${LOGOUT_COMPLETE_PATH}?${query.toString()}`;
}

/**
 * 로그아웃 완료 화면이 실제로 쓸 복귀 주소.
 *
 * **same-origin 상대경로만 통과시킨다.** 이 값은 주소창에서 그대로 오고, 화면은
 * 그걸 링크로 내보낸다. 검사가 없으면 `/logout?returnTo=https://evil.example`
 * 한 줄로 "로그아웃했습니다 → 다시 로그인" 흐름이 남의 로그인 화면으로 이어진다.
 * 방금 계정을 다루던 사람은 그 링크를 의심하지 않는다.
 */
export function resolveLogoutReturnTo(searchParams: SearchParamsInput): string {
  return toInternalPath(
    readSearchParam(searchParams, LOGOUT_RETURN_TO_PARAM),
    LOGOUT_DEFAULT_RETURN_TO,
  );
}
