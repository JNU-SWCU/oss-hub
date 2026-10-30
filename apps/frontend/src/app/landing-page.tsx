'use client';

import { useEffect, useState } from 'react';
import { AUTH_ERROR_MESSAGE, hasAuthError } from '@/features/auth/auth-error';
import { useNavigationNotices } from '@/lib/navigation-notices';
import { CurrentProgramSection } from '@/features/landing/components/current-program-section';
import { LandingJourney } from '@/features/landing/components/landing-journey';
import { LandingFooter } from '@/features/landing/components/landing-footer';
import { LandingEntryActionView } from './_shell/landing-entry-action';
import { SessionError } from './_shell/session-error';
import { useSessionRole } from './_shell/use-session-role';
import type { LandingData } from '@/features/landing/server/load-landing-data';

export function LandingPage({ recruiting, starPrograms, stats }: LandingData) {
  const session = useSessionRole();
  const { status, isProfileComplete, retry } = session;
  const [serializedSearchParams, setSerializedSearchParams] = useState('');
  const authErrorMessage = hasAuthError(serializedSearchParams)
    ? AUTH_ERROR_MESSAGE
    : undefined;
  const notices = useNavigationNotices();
  const justLoggedOut = notices.status === 'ready' && notices.loggedOut;

  useEffect(() => {
    setSerializedSearchParams(window.location.search);
  }, []);

  const entryAction = justLoggedOut ? undefined : (
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
          starPrograms={starPrograms}
          stats={stats}
          authErrorMessage={authErrorMessage}
          contentAnchor="#current-programs"
          primaryAction={entryAction}
        />

        <div className="relative z-10 bg-background">
          {status === 'error' ? <SessionError onRetry={retry} /> : null}
          <CurrentProgramSection programs={recruiting} />
        </div>
      </main>
      <div className="relative z-30">
        <LandingFooter />
      </div>
    </>
  );
}
