/**
 * 아직 회원이 아닌 사람이 보는 화면 경로 — `AppFrame`이 사이드바 없이 상단 Nav만
 * 쓰는 분기와, 가입 동선 목록 포함 관계 검사(`signup-routes.test.ts`)가 함께 읽는다.
 * 내 상황 사이드바는 가입 완료 후에만 `ProductShell`이 단다.
 *
 * `/onboarding/pending`은 여기 없다. 교직원이 프로필까지 마친 뒤 승인을 기다리는
 * 화면이라 정의상 이미 회원이고, 역할만 아직 붙지 않았다.
 */
export const PRE_MEMBER_PATHS: ReadonlySet<string> = new Set([
  '/',
  '/signup',
  '/consent',
  '/onboarding/role',
  '/onboarding/profile',
]);

/**
 * 그중 본문이 어두운 우주 바탕 위에 서는 화면. `AppFrame`이 `bg-cosmos-void`를
 * 주는 목록이다. 상단 바는 여기와 무관하게 전 화면 흰 바다.
 *
 * 랜딩(`/`)은 빠져 있다 — 랜딩 본문의 우주는 `LandingJourney`가 스스로 칠하고,
 * 그 아래 밝은 구간은 페이지가 이어 붙인다. 가입 화면은 처음부터 끝까지 이
 * 바탕 한 장이다.
 */
export const COSMOS_GROUND_PATHS: ReadonlySet<string> = new Set([
  '/signup',
  '/consent',
  '/onboarding/role',
  '/onboarding/profile',
]);

/**
 * 가입 절차를 걷는 동안 서는 화면 — 여기서만 GitHub 계정 표식(오른쪽 위 아바타)을
 * 낸다.
 *
 * 가입을 마치지 않은 사람에게 그 표식은 "당신은 회원이다"가 아니라 "이 절차가 잘
 * 이어지고 있다"는 뜻이어야 한다. 그래서 표식이 설 자리를 이 목록 안으로 가둔다 —
 * 밖에서까지 계속 보이면 약관에서 멈췄든 프로필에서 멈췄든 오른쪽 위에 GitHub
 * 계정이 떠 있어, 그 사람도 보는 사람도 가입이 끝난 것으로 읽는다. 실제 판단은
 * `signup-completion.ts`가 이 목록과 세션 상태를 함께 보고 내린다.
 *
 * `/onboarding/pending`이 여기 들어 있는 것이 `PRE_MEMBER_PATHS`와의 유일한 차이다.
 * 승인을 기다리는 교직원은 이미 회원이라 이 목록 없이도 표식을 받지만, **반려된**
 * 요청을 들고 같은 화면에 서는 사람은 회원이 아니다. 빼 두면 그 사람에게만 계정
 * 메뉴가 사라져 역할을 다시 고르러 가기도, 로그아웃하기도 어려워진다.
 *
 * 랜딩(`/`)은 없다. 가입 절차가 아니라 누구에게나 열린 공개 화면이고, 애초에 "가입
 * 화면 밖에서는 회원처럼 보이지 않게 한다"의 그 밖이 바로 여기다.
 */
export const SIGNUP_FLOW_PATHS: ReadonlySet<string> = new Set([
  '/signup',
  '/consent',
  '/onboarding/role',
  '/onboarding/profile',
  '/onboarding/pending',
]);
