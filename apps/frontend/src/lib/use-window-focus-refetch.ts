'use client';

import { useEffect } from 'react';

export function useWindowFocusRefetch(
  refetch: (options: { readonly cancelRefetch: boolean }) => Promise<unknown>,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void refetch({ cancelRefetch: false });
      }
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [enabled, refetch]);
}
