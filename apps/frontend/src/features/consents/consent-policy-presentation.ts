export const CONSENT_POLICY_INLINE_BREAKPOINT_PX = 1280;

export type ConsentPolicyPresentation = 'inline' | 'dialog';

export function selectConsentPolicyPresentation(
  viewportWidthPx: number,
): ConsentPolicyPresentation {
  return viewportWidthPx >= CONSENT_POLICY_INLINE_BREAKPOINT_PX
    ? 'inline'
    : 'dialog';
}
