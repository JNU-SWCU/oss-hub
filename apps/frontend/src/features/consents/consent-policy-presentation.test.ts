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

  // 이 구간이 처음에 비어 있었다. 판정만 1024로 내려가 있어 1024~1279에서 전문이
  // 120~376px로 눌렸고, 1440·768·375만 재던 실측은 그 사이를 통째로 비껴갔다.
  it('중간 데스크톱 구간(1024~1279)은 아직 팝업이다', () => {
    expect(selectConsentPolicyPresentation(1024)).toBe('dialog');
    expect(selectConsentPolicyPresentation(1200)).toBe('dialog');
    expect(selectConsentPolicyPresentation(1279)).toBe('dialog');
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
