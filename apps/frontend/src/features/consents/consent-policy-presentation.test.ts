import { describe, expect, it } from 'vitest';

import {
  CONSENT_POLICY_INLINE_BREAKPOINT_PX,
  selectConsentPolicyPresentation,
} from './consent-policy-presentation';

describe('selectConsentPolicyPresentation', () => {
  // 완료 조건이 못 박은 세 폭이다(#517).
  it('넓은 화면(1440)은 화면 안에 펼치고, 768·375는 팝업으로 띄운다', () => {
    expect(selectConsentPolicyPresentation(1440)).toBe('inline');
    expect(selectConsentPolicyPresentation(768)).toBe('dialog');
    expect(selectConsentPolicyPresentation(375)).toBe('dialog');
  });

  it('경계값은 인라인 쪽에 포함된다', () => {
    expect(
      selectConsentPolicyPresentation(CONSENT_POLICY_INLINE_BREAKPOINT_PX),
    ).toBe('inline');
    expect(
      selectConsentPolicyPresentation(CONSENT_POLICY_INLINE_BREAKPOINT_PX - 1),
    ).toBe('dialog');
  });
});
