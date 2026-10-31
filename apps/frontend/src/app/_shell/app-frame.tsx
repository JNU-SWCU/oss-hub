'use client';

import { hasAuthError } from '@/features/auth/auth-error';
import {
  getLoginDestinationStorage,
  takeLoginDestination,
} from '@/features/auth/login-destination';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CurrentConsent } from '@/features/consents/api';
import { useCurrentConsentQuery } from '@/features/consents/queries';
import { featureKey } from '@/lib/query-keys';
import { ConsentRequiredDialog } from '@/features/consents/components/consent-required-dialog';
import { BottomTabBar } from './bottom-tab-bar';
import { ProductShell, ShellMenuProvider } from './product-shell';
import { ProgramNameReportProvider } from './program-name-report-context';
import { sectionItemsFor } from './section-list';
import { ShellNav } from './shell-nav';
import { hasShellSidebar, shellSheetKind } from './sidebar-presence';
import {
  COSMOS_GROUND_PATHS,
  PRE_MEMBER_PATHS,
  SIGNUP_FLOW_PATHS,
} from './signup-routes';
import { SessionError } from './session-error';
import { SessionRoleProvider } from './session-role-context';
import { useSessionRole } from './use-session-role';
import { SkipLink } from './skip-link';

type AppFrameProps = {
  readonly brand?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly initialSidebarCollapsed?: boolean;
};

export function AppFrame(props: AppFrameProps) {
  const pathname = usePathname();
  if (pathname.startsWith('/policies/')) {
    return props.children;
  }

  return (
    <>
      <SkipLink />
      <SessionAppFrame {...props} />
    </>
  );
}

function SessionAppFrame({
  brand,
  actions,
  children,
  initialSidebarCollapsed = false,
}: AppFrameProps) {
  const pathname = usePathname();
  const session = useSessionRole();
  const { status, isProfileComplete } = session;
  const queryClient = useQueryClient();
  const shouldCheckConsent =
    status === 'assigned' && !SIGNUP_FLOW_PATHS.has(pathname);
  const consent = useCurrentConsentQuery(shouldCheckConsent);
  const consentStatus = consent.isError
    ? 'error'
    : consent.data === undefined
      ? 'checking'
      : consent.data.consented
        ? 'complete'
        : 'required';

  const handleConsentCompleted = useCallback(() => {
    queryClient.setQueryData<CurrentConsent>(
      featureKey('consents'),
      (current) => current && { ...current, consented: true },
    );
  }, [queryClient]);
  const consentRequiredDialog = shouldCheckConsent ? (
    <ConsentRequiredDialog
      open={consentStatus === 'required'}
      onOpenChange={() => {}}
      onCompleted={handleConsentCompleted}
    />
  ) : null;
  const content =
    !shouldCheckConsent ||
    consentStatus === 'checking' ||
    consentStatus === 'complete' ? (
      children
    ) : consentStatus === 'error' ? (
      <SessionError onRetry={() => void consent.refetch()} />
    ) : (
      <p className="p-6 text-sm text-muted-foreground" role="status">
        확인 중…
      </p>
    );
  useEffect(() => {
    if (status !== 'assigned' || !isProfileComplete) return;
    if (pathname !== '/' && pathname !== '/dashboard') return;
    if (hasAuthError(window.location.search)) return;
    const destination = takeLoginDestination(getLoginDestinationStorage());
    if (destination && destination !== pathname)
      window.location.replace(destination);
  }, [status, isProfileComplete, pathname]);
  const onCosmosGround = COSMOS_GROUND_PATHS.has(pathname);
  const preMember = PRE_MEMBER_PATHS.has(pathname);

  const navItems = useMemo(
    () => sectionItemsFor({ status, isProfileComplete }),
    [status, isProfileComplete],
  );

  if (preMember) {
    return (
      <SessionRoleProvider value={session}>
        <div
          className={
            onCosmosGround
              ? 'flex min-h-dvh flex-col bg-cosmos-void'
              : undefined
          }
        >
          <ShellNav brand={brand} items={navItems} actions={actions} />

          <div
            className={
              onCosmosGround ? 'flex min-h-0 flex-1 flex-col' : undefined
            }
            data-surface={onCosmosGround ? 'inverted' : undefined}
            id="main-content"
            tabIndex={-1}
          >
            {content}
          </div>
        </div>
        {consentRequiredDialog}
      </SessionRoleProvider>
    );
  }

  return (
    <SessionRoleProvider value={session}>
      <ShellMenuProvider
        initialCollapsed={initialSidebarCollapsed}
        sidebarAvailable={hasShellSidebar(pathname, session)}
        sheetAvailable={shellSheetKind(pathname, session) !== null}
      >
        <ProgramNameReportProvider>
          <div className="flex h-dvh flex-col overflow-hidden">
            <ShellNav
              brand={brand}
              items={navItems}
              actions={actions}
              compactMenu={false}
            />
            <ProductShell>{content}</ProductShell>
            <BottomTabBar items={navItems} pathname={pathname} />
          </div>
        </ProgramNameReportProvider>
      </ShellMenuProvider>
      {consentRequiredDialog}
    </SessionRoleProvider>
  );
}
