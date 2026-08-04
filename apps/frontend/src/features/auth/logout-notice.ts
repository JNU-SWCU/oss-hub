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

/**
 * 로그아웃한 사람을 되돌려 놓으면 안 되는 자리. 두 종류다.
 *
 * 1. **로그아웃 완료 화면 자신**(`/logout`). 자기를 복귀 주소로 실으면 "다른 계정으로
 *    로그인"이 같은 화면을 다시 그린다 — 눌러도 제자리라 사용자에게는 고장으로 읽힌다.
 * 2. **가입 절차 화면**(`/signup`·`/consent`·`/onboarding/**`). 절차의 중간 지점이라
 *    앞 단계를 마친 사람에게만 뜻이 있다. 방금 세션을 버린 사람을 약관 동의나 역할 선택
 *    화면에 떨어뜨리면, 그는 자기가 어디까지 했는지 알 수 없는 절차 한가운데 서게 된다.
 *    다시 시작하는 자리는 입구(`LOGOUT_DEFAULT_RETURN_TO`) 하나로 모은다.
 *
 * 접두사로 보되 경계는 **세그먼트**다 — `/onboarding` 아래 화면이 늘어도 규칙이 따라가고,
 * `/signup-guide`처럼 이름만 겹치는 다른 화면까지 막지는 않는다.
 *
 * 가입 절차 화면 목록의 원본은 `app/_shell/signup-routes.ts`지만 의존 방향이
 * app → features 단방향이라 여기서 읽을 수 없다(docs/rules/frontend.md). 두 목록이
 * 어긋나는 순간은 둘 다 볼 수 있는 app 계층의 검사(`_shell/signup-routes.test.ts`)가 잡는다.
 */
const NON_RETURNABLE_PREFIXES: readonly string[] = [
  LOGOUT_COMPLETE_PATH,
  SIGNUP_ENTRY.href,
  '/consent',
  '/onboarding',
];

/**
 * 복귀 주소로 쓸 수 있는 값인가.
 *
 * `toInternalPath`(open redirect 관문)를 통과한 뒤 한 겹 더 본다. 저쪽은 "우리 앱의
 * 주소인가"를, 이쪽은 "로그아웃한 사람을 여기 세워도 되는가"를 판단한다 — 섞으면
 * lib의 범용 관문에 이 화면 사정이 스며든다.
 *
 * **쿼리·해시가 붙은 값은 통째로 떨군다.** 복귀 주소는 주소창에 그대로 남아 복사·공유되고
 * 서버 로그에도 남는데, 이 앱의 쿼리에는 화면 상태만이 아니라 식별자가 실릴 수 있다
 * (`/admin/access/users/[userId]` 계열 화면의 목록 필터 등). 경로만으로도 "있던 화면"은
 * 되찾히므로 값을 좁게 받는 편이 싸다. 해시는 애초에 서버에 가지도 않는다.
 */
function isReturnableAfterLogout(path: string): boolean {
  if (path.includes('?') || path.includes('#')) {
    return false;
  }
  return !NON_RETURNABLE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * 밖에서 온 값을 복귀 주소로 확정한다 — 주소를 **만들 때**와 **읽을 때** 같은 판정을
 * 쓰기 위한 한 벌. 한쪽에만 걸면 주소창에 직접 적어 넣은 값이 검사를 비켜 간다.
 */
function toLogoutReturnTo(value: unknown): string {
  const path = toInternalPath(value, LOGOUT_DEFAULT_RETURN_TO);
  return isReturnableAfterLogout(path) ? path : LOGOUT_DEFAULT_RETURN_TO;
}

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
  const resolved = toLogoutReturnTo(returnTo);
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
 *
 * 자기 자신·가입 절차 화면도 여기서 함께 떨군다 — 주소를 만드는 쪽만 막으면 손으로 적어
 * 넣은 `/logout?returnTo=/logout`이 그대로 통과한다.
 */
export function resolveLogoutReturnTo(searchParams: SearchParamsInput): string {
  return toLogoutReturnTo(
    readSearchParam(searchParams, LOGOUT_RETURN_TO_PARAM),
  );
}
