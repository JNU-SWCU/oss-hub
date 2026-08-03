/**
 * 약관 전문을 화면 안(`inline`)에 펼칠지 팝업(`dialog`)으로 띄울지 가르는 폭(#517).
 *
 * 오른쪽 전문에 남는 폭은 `뷰포트 - 864px`로 고정이다 — 진행 눈금 96 · 본문 오른쪽
 * 여백 48 · 왼쪽 기둥 672 · 열 간격 48이 먼저 자리를 가져간다. 그래서 이 값은
 * 실측으로 정했다: 전문의 읽는 폭이 **가장 좁은 팝업(375px, 301px · 26자/줄)을
 * 넘어서는 첫 표준 정지점**이 1280px(376px · 35자/줄)이다. 1200px은 그 팝업과
 * 같아질 뿐이고, 그 아래로는 인라인이 팝업보다 나쁘다 — 1024px에서는 120px ·
 * 12자/줄까지 눌렸다.
 *
 * **이 값은 `consent-flow.tsx`·`app/consent/page.tsx`의 `min-[1280px]:` 변형과 반드시
 * 같아야 한다.** 둘이 갈라지면 판정은 인라인인데 레이아웃은 한 기둥인(또는 그 반대)
 * 구간이 생긴다 — 실제로 그 구간이 이 결함이었다. `consent-policy-breakpoint.test.ts`가
 * 두 소스의 문자열을 직접 비교해 못 박는다.
 */
export const CONSENT_POLICY_INLINE_BREAKPOINT_PX = 1280;

export type ConsentPolicyPresentation = 'inline' | 'dialog';

/** 뷰포트 폭(px)만으로 전문 표시 방식을 고르는 순수 함수 — DOM에 접근하지 않는다. */
export function selectConsentPolicyPresentation(
  viewportWidthPx: number,
): ConsentPolicyPresentation {
  return viewportWidthPx >= CONSENT_POLICY_INLINE_BREAKPOINT_PX
    ? 'inline'
    : 'dialog';
}
