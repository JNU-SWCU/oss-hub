/**
 * 아직 회원이 아닌 사람이 보는 화면의 경로 목록 — 셸 분기와 헤더 표면이 함께 읽는다.
 *
 * 판단 기준은 **회원가입의 정의**다. GitHub 연결만으로는 가입이 아니고, 프로필
 * 입력까지 마쳐야 회원이다. GitHub만 연결한 사람은 가입 화면이 궁금해서 들어와 본
 * 사람일 수 있어, 아직 회원으로 세지 않는다.
 *
 * 그래서 로그인 뒤 화면이라도 가입을 마치기 전이면(`/consent`·`/onboarding/role`·
 * `/onboarding/profile`) 여기에 들어온다. 예전에는 "로그인했으면 이미 안에 있는
 * 사람"으로 보아 업무 사이드바를 붙였는데, 그 전제가 정의와 함께 뒤집혔다.
 * 실제로 그 사이드바는 가입 중인 학생이 프로그램 목록으로 빠져나가는 통로였다.
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
 * 그중 어두운 우주 바탕 위에 서는 화면. 헤더가 흰 바 대신 투명 + 흰 글자가 된다.
 *
 * 랜딩(`/`)은 빠져 있다 — 랜딩만 스크롤을 따라 어두운 여정에서 흰 구간으로 넘어가
 * 헤더 표면이 도중에 바뀌고, 그 전환은 `shell-nav.tsx`가 표식을 관찰해 따로
 * 처리한다. 가입 화면은 처음부터 끝까지 어두우므로 관찰할 것이 없다.
 */
export const COSMOS_GROUND_PATHS: ReadonlySet<string> = new Set([
  '/signup',
  '/consent',
  '/onboarding/role',
  '/onboarding/profile',
]);
