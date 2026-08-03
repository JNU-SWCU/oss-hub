/**
 * 약관 전문을 화면 안(`inline`)에 펼칠지 팝업(`dialog`)으로 띄울지 가르는 폭 —
 * Tailwind `lg:`와 같은 1024px다(#517).
 *
 * 동의 항목 기둥이 `max-w-2xl`(672px)이라, 전문을 그 오른쪽에 나란히 놓으려면
 * 진행 눈금·여백까지 더해 최소 이만큼이 필요하다. 768px에서는 나란히 놓을 자리가
 * 없어 팝업이 남는다.
 */
export const CONSENT_POLICY_INLINE_BREAKPOINT_PX = 1024;

export type ConsentPolicyPresentation = 'inline' | 'dialog';

/** 뷰포트 폭(px)만으로 전문 표시 방식을 고르는 순수 함수 — DOM에 접근하지 않는다. */
export function selectConsentPolicyPresentation(
  viewportWidthPx: number,
): ConsentPolicyPresentation {
  return viewportWidthPx >= CONSENT_POLICY_INLINE_BREAKPOINT_PX
    ? 'inline'
    : 'dialog';
}
