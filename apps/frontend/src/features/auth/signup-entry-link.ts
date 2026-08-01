/**
 * 가입·로그인 진입 지점. 로그인 수단이 GitHub 하나뿐이라 가입과 로그인이 같은
 * 동작이고, 그래서 진입도 버튼 하나다.
 *
 * OAuth로 곧장 나가지 않고 `/signup`을 한 번 거친다 — 무슨 일이 일어나는지, GitHub
 * 계정이 없으면 어떻게 하는지를 말할 자리가 그 화면이다.
 *
 * app이 아니라 auth feature에 둔다. 의존 방향이 app → features 단방향이라
 * (docs/rules/frontend.md) nav의 LoginButton은 app 쪽 상수를 읽을 수 없고, 그러면
 * 사본을 따로 들 수밖에 없다. **진입점이 둘인데 목적지가 갈라지는 것**이 애초의
 * 문제였으므로, 두 호출부가 같은 값을 읽도록 여기 한 벌만 둔다.
 *
 * `compactLabel`은 nav 슬롯이 좁을 때(<640px) 쓰는 짧은 라벨이다. 좁은 화면에서
 * actions는 `shrink-0`이라 물러서지 않고 메뉴를 파고든다(components/nav-bar.tsx).
 */
export const SIGNUP_ENTRY = {
  href: '/signup',
  label: '회원가입 / 로그인',
  compactLabel: '회원가입',
} as const;

/**
 * nav의 진입 버튼을 내야 하는가.
 *
 * 지금 보고 있는 화면이 곧 목적지면 버튼을 내지 않는다. 누르면 아무 일도 일어나지
 * 않는 것처럼 보이고, 사용자는 화면이 멈췄는지 자기가 잘못 눌렀는지 알 수 없다.
 * `/signup`에서 "회원가입 / 로그인" 버튼이 실제로 그랬다.
 *
 * 목적지 문자열끼리 비교한다 — 어떤 진입 버튼이든(가입·로그인이든 역할 홈이든)
 * 같은 규칙을 받아야 하기 때문에 `/signup`을 여기에 박지 않는다.
 */
export function shouldShowEntryLink(
  destinationHref: string,
  pathname: string,
): boolean {
  return destinationHref !== pathname;
}
