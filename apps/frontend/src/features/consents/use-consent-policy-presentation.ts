'use client';

import { useEffect, useState } from 'react';

import {
  CONSENT_POLICY_INLINE_BREAKPOINT_PX,
  selectConsentPolicyPresentation,
  type ConsentPolicyPresentation,
} from './consent-policy-presentation';

/**
 * 지금 폭에서 약관 전문을 어떻게 낼지 추적한다(#517).
 *
 * 서버 렌더에는 `window`가 없으므로 항상 `dialog`로 시작한다. 닫혀 있는 동안 두
 * 갈래는 화면에 아무것도 그리지 않으므로, hydration 뒤 값이 뒤집혀도 보이는
 * 것은 변하지 않는다.
 */
export function useConsentPolicyPresentation(): ConsentPolicyPresentation {
  const [presentation, setPresentation] =
    useState<ConsentPolicyPresentation>('dialog');

  useEffect(() => {
    const query = window.matchMedia(
      `(min-width: ${CONSENT_POLICY_INLINE_BREAKPOINT_PX}px)`,
    );
    const sync = (): void =>
      setPresentation(selectConsentPolicyPresentation(window.innerWidth));
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return presentation;
}
