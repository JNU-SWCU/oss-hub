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

  // 어두운 표면(우주 여정·하단 CTA)은 반전 버튼을 쓴다.
  // 밝은 본문의 로그인 CTA는 journey panel 4·ClosingCta에만 둔다 — solid
  // "시작하기" 섹션은 journey 진입 CTA와 중복이라 두지 않는다.
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

        {/*
          우주 연출은 첫 화면에서 끝난다. 여기부터는 실제 업무 화면과 같은 밝은
          레이아웃이다. 헤더는 전 화면 흰 바로 고정되어 있고(z-40), 이 구간이
          메뉴를 덮지 않는다.
        */}
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
