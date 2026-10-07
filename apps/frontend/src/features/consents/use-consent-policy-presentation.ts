'use client';

import { useEffect, useState } from 'react';

import {
  CONSENT_POLICY_INLINE_BREAKPOINT_PX,
  selectConsentPolicyPresentation,
  type ConsentPolicyPresentation,
} from './consent-policy-presentation';

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
