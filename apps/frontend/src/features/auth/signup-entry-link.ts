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
