'use client';

import { useEffect, useState } from 'react';
import { AUTH_ERROR_MESSAGE, hasAuthError } from '@/features/auth/auth-error';
import { LogoutNoticeBanner } from '@/features/auth/components/logout-notice-banner';
import { hasLogoutNotice } from '@/features/auth/logout-notice';
import { ClosingCtaSection } from '@/features/landing/components/closing-cta-section';
import { CurrentProgramSection } from '@/features/landing/components/current-program-section';
import { LandingJourney } from '@/features/landing/components/landing-journey';
import { LandingFooter } from '@/features/landing/components/landing-footer';
import { ProgramFlowSection } from '@/features/landing/components/program-flow-section';
import { LandingEntryActionView } from './_shell/landing-entry-action';
import { SessionError } from './_shell/session-error';
import { useSessionRole } from './_shell/use-session-role';

export default function HomePage() {
  const session = useSessionRole();
  const { status, isProfileComplete, retry } = session;
  const [serializedSearchParams, setSerializedSearchParams] = useState('');
  const authErrorMessage = hasAuthError(serializedSearchParams)
    ? AUTH_ERROR_MESSAGE
    : undefined;
  const showLogoutNotice = hasLogoutNotice(serializedSearchParams);

  useEffect(() => {
    setSerializedSearchParams(window.location.search);
  }, []);

  const entryAction = (
    <LandingEntryActionView
      hasAuthError={Boolean(authErrorMessage)}
      inverted
      isProfileComplete={isProfileComplete}
      access={session}
      status={status}
    />
  );

  return (
    <>
      <main>
        <LandingJourney
          authErrorMessage={authErrorMessage}
          contentAnchor="#current-programs"
          notice={showLogoutNotice ? <LogoutNoticeBanner /> : undefined}
          primaryAction={entryAction}
        />

        <div className="relative z-10 bg-background">
          {status === 'error' ? <SessionError onRetry={retry} /> : null}
          <CurrentProgramSection />
          <ProgramFlowSection />
          <ClosingCtaSection action={entryAction} />
        </div>
      </main>
      <div className="relative z-30">
        <LandingFooter />
      </div>
    </>
  );
}
