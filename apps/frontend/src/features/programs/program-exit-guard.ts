export interface ProgramExitGuard {
  readonly setDirty: (dirty: boolean) => void;
  readonly isDirty: () => boolean;
  readonly shouldInterceptNavigation: () => boolean;
  readonly requestLeave: () => boolean;
  readonly requestNavigate: (path: string) => boolean;
  readonly completeAndNavigate: (path: string) => void;
  readonly dispose: () => void;
}

interface ProgramExitGuardDependencies {
  readonly pushSentinel: () => void;
  readonly back: () => void;
  readonly confirmExit: () => boolean;
  readonly navigate: (path: string) => void;
  readonly subscribePopState: (listener: () => void) => () => void;
}

type PendingTransition =
  | { readonly kind: 'collapse' }
  | { readonly kind: 'dispose' }
  | { readonly kind: 'leave' }
  | { readonly kind: 'navigate'; readonly path: string };

export function installProgramExitGuard(
  dependencies: ProgramExitGuardDependencies,
): ProgramExitGuard {
  let dirty = false;
  let sentinelActive = false;
  let disposed = false;
  let pendingTransition: PendingTransition | null = null;
  let unsubscribePopState: () => void = () => undefined;

  const pushSentinel = () => {
    if (disposed || sentinelActive || pendingTransition) return;
    dependencies.pushSentinel();
    sentinelActive = true;
  };

  const startTransition = (transition: PendingTransition) => {
    if (sentinelActive) {
      const alreadyPopping = pendingTransition !== null;
      pendingTransition = transition;
      if (!alreadyPopping) dependencies.back();
      return;
    }

    switch (transition.kind) {
      case 'collapse':
        if (dirty) pushSentinel();
        return;
      case 'dispose':
        disposed = true;
        unsubscribePopState();
        return;
      case 'leave':
        dependencies.back();
        return;
      case 'navigate':
        dependencies.navigate(transition.path);
        return;
    }
  };

  const confirmIfDirty = (): boolean => !dirty || dependencies.confirmExit();

  const handlePopState = () => {
    if (disposed) return;
    sentinelActive = false;

    if (pendingTransition) {
      const transition = pendingTransition;
      pendingTransition = null;
      startTransition(transition);
      return;
    }

    if (!dirty) return;
    if (!dependencies.confirmExit()) {
      pushSentinel();
      return;
    }

    dirty = false;
    dependencies.back();
  };

  unsubscribePopState = dependencies.subscribePopState(handlePopState);

  return {
    setDirty: (nextDirty) => {
      if (disposed || dirty === nextDirty) return;
      dirty = nextDirty;
      if (dirty) {
        pushSentinel();
        return;
      }
      startTransition({ kind: 'collapse' });
    },
    isDirty: () => dirty,
    shouldInterceptNavigation: () =>
      dirty || sentinelActive || pendingTransition !== null,
    requestLeave: () => {
      if (disposed || !confirmIfDirty()) return false;
      dirty = false;
      startTransition({ kind: 'leave' });
      return true;
    },
    requestNavigate: (path) => {
      if (disposed || !confirmIfDirty()) return false;
      dirty = false;
      startTransition({ kind: 'navigate', path });
      return true;
    },
    completeAndNavigate: (path) => {
      if (disposed) return;
      dirty = false;
      startTransition({ kind: 'navigate', path });
    },
    dispose: () => {
      if (disposed) return;
      dirty = false;
      startTransition({ kind: 'dispose' });
    },
  };
}
