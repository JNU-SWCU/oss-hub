'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AUTH_ERROR_MESSAGE, hasAuthError } from '@/features/auth/auth-error';
import {
  GITHUB_LOGOUT_URL,
  LOGOUT_NOTICE_MESSAGE,
  hasLogoutNotice,
} from '@/features/auth/logout-notice';
import { ClosingCtaSection } from '@/features/landing/components/closing-cta-section';
import { CurrentProgramSection } from '@/features/landing/components/current-program-section';
import { LandingJourney } from '@/features/landing/components/landing-journey';
import { LandingFooter } from '@/features/landing/components/landing-footer';
import { ProgramFlowSection } from '@/features/landing/components/program-flow-section';
import { LandingEntryActionView } from './_shell/landing-entry-action';
import { LANDING_SOLID_SENTINEL_ID } from './_shell/shell-nav';
import { SessionError } from './_shell/session-error';
import { useSessionRole } from './_shell/use-session-role';

export default function HomePage() {
  const { status, role, isProfileComplete, retry } = useSessionRole();
  const [serializedSearchParams, setSerializedSearchParams] = useState('');
  const authErrorMessage = hasAuthError(serializedSearchParams)
    ? AUTH_ERROR_MESSAGE
    : undefined;
  const showLogoutNotice = hasLogoutNotice(serializedSearchParams);

  useEffect(() => {
    setSerializedSearchParams(window.location.search);
  }, []);

  // 어두운 표면(우주 여정·하단 CTA)은 반전 버튼, 밝은 표면은 기본 버튼을 쓴다.
  const entryAction = (
    <LandingEntryActionView
      hasAuthError={Boolean(authErrorMessage)}
      inverted
      isProfileComplete={isProfileComplete}
      role={role}
      status={status}
    />
  );
  const entryActionOnLight = (
    <LandingEntryActionView
      hasAuthError={Boolean(authErrorMessage)}
      isProfileComplete={isProfileComplete}
      role={role}
      status={status}
    />
  );

  return (
    <>
      <main>
        <LandingJourney
          authErrorMessage={authErrorMessage}
          notice={
            showLogoutNotice ? (
              <>
                {LOGOUT_NOTICE_MESSAGE}{' '}
                <a
                  href={GITHUB_LOGOUT_URL}
                  className="font-semibold text-cosmos-copy underline underline-offset-2"
                  rel="noreferrer noopener"
                >
                  GitHub에서 로그아웃
                </a>
              </>
            ) : undefined
          }
          primaryAction={entryAction}
        />

        {/*
          우주 연출은 첫 화면에서 끝난다. 여기부터는 실제 업무 화면과 같은 밝은
          레이아웃이다. 예전에는 이 구간이 헤더를 덮어 버려 아래쪽에서는 메뉴가
          아예 사라졌다. 이제는 헤더가 위에 남고(z-40) 대신 표면을 흰 바로 바꾼다
          — 아래 표식이 헤더에 닿는 순간이 그 전환 시점이다(ShellNav).
        */}
        <div className="relative z-10 bg-background">
          <div
            id={LANDING_SOLID_SENTINEL_ID}
            aria-hidden="true"
            className="h-px w-full"
          />
          <section
            id="landing-entry"
            aria-labelledby="landing-entry-section-heading"
            className="border-b border-border bg-background"
          >
            <div className="mx-auto max-w-6xl px-6 py-16 sm:px-8 lg:py-20">
              <p className="text-sm font-semibold text-primary">시작하기</p>
              <h2
                id="landing-entry-section-heading"
                className="mt-2 break-keep text-3xl font-bold tracking-tight text-foreground"
              >
                역할에 맞는 화면으로 이동합니다
              </h2>
              <p className="mt-3 max-w-2xl break-keep text-sm leading-relaxed text-muted-foreground">
                GitHub 계정으로 로그인하면 학생·교직원·관리자 각각의 화면으로
                연결됩니다. 로그인 없이도 모집 중인 프로그램과 공개 아카이브는
                둘러볼 수 있습니다.
              </p>
              <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-5">
                {entryActionOnLight}
                <Link
                  href="/programs"
                  className="inline-flex min-h-11 items-center justify-center text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/75"
                >
                  프로그램 둘러보기
                </Link>
              </div>
            </div>
          </section>

          {status === 'error' ? <SessionError onRetry={retry} /> : null}
          <CurrentProgramSection
            allowLocalExamples={process.env.NODE_ENV === 'development'}
          />
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
