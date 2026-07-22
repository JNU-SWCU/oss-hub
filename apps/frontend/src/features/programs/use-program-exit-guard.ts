'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { UNSAVED_PROGRAM_MESSAGE } from './program-creation-flow';
import {
  installProgramExitGuard,
  type ProgramExitGuard,
} from './program-exit-guard';

export function useProgramExitGuard(dirty: boolean) {
  const router = useRouter();
  const exitGuard = useRef<ProgramExitGuard | null>(null);

  useEffect(() => {
    const guard = installProgramExitGuard({
      pushSentinel: () =>
        window.history.pushState(null, '', window.location.href),
      back: () => window.history.back(),
      confirmExit: () => window.confirm(UNSAVED_PROGRAM_MESSAGE),
      navigate: (path) => router.push(path),
      subscribePopState: (listener) => {
        window.addEventListener('popstate', listener);
        return () => window.removeEventListener('popstate', listener);
      },
    });
    const handleLinkClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !guard.shouldInterceptNavigation() ||
        !(event.target instanceof Element)
      )
        return;
      const anchor = event.target.closest('a[href]');
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download')
      )
        return;
      const destination = new URL(anchor.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        destination.href === window.location.href
      )
        return;
      event.preventDefault();
      guard.requestNavigate(
        `${destination.pathname}${destination.search}${destination.hash}`,
      );
    };
    exitGuard.current = guard;
    document.addEventListener('click', handleLinkClick, true);
    return () => {
      document.removeEventListener('click', handleLinkClick, true);
      exitGuard.current = null;
      guard.dispose();
    };
  }, [router]);

  useEffect(() => {
    exitGuard.current?.setDirty(dirty);
  }, [dirty]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!exitGuard.current?.isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return {
    leavePage: () => {
      if (!exitGuard.current) router.back();
      else exitGuard.current.requestLeave();
    },
    completeAndNavigate: (path: string) => {
      if (!exitGuard.current) router.push(path);
      else exitGuard.current.completeAndNavigate(path);
    },
  };
}
