import { AUTH_ERROR_MESSAGE, hasAuthError } from '@/features/auth/auth-error';
import {
  GITHUB_LOGOUT_URL,
  LOGOUT_NOTICE_MESSAGE,
  hasLogoutNotice,
} from '@/features/auth/logout-notice';
import { ClosingCtaSection } from '@/features/landing/components/closing-cta-section';
import { LandingFooter } from '@/features/landing/components/landing-footer';
import { LandingHero } from '@/features/landing/components/landing-hero';
import { ProgramFlowSection } from '@/features/landing/components/program-flow-section';
import { ProgramTypeSection } from '@/features/landing/components/program-type-section';
import { RolePathSection } from '@/features/landing/components/role-path-section';
import { LandingEntryAction } from './_shell/landing-entry-action';

interface HomePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = await searchParams;
  const authErrorMessage = hasAuthError(resolvedSearchParams)
    ? AUTH_ERROR_MESSAGE
    : undefined;
  const showLogoutNotice = hasLogoutNotice(resolvedSearchParams);

  return (
    <>
      <main>
        {/* #136: `/`는 로그인 상태와 무관하게 항상 랜딩을 렌더한다. 자동
            역할 홈 리다이렉트(#144)는 back-trap 문제로 제거됐다 — 역할 홈
            진입은 nav의 RoleHomeNavLink로 대체됐다. */}
        <LandingHero
          authErrorMessage={authErrorMessage}
          notice={
            showLogoutNotice ? (
              <>
                {LOGOUT_NOTICE_MESSAGE}{' '}
                <a
                  href={GITHUB_LOGOUT_URL}
                  className="font-semibold text-hero-foreground underline underline-offset-2"
                  rel="noreferrer noopener"
                >
                  GitHub에서 로그아웃
                </a>
              </>
            ) : undefined
          }
          primaryAction={
            // 히어로가 어두운 표면이 되었으므로 흰 버튼이어야 대비가 확보된다
            <LandingEntryAction
              hasAuthError={Boolean(authErrorMessage)}
              inverted
            />
          }
        />
        <ProgramTypeSection />
        <ProgramFlowSection />
        <RolePathSection />
        <ClosingCtaSection
          action={
            <LandingEntryAction
              hasAuthError={Boolean(authErrorMessage)}
              inverted
            />
          }
        />
      </main>
      <LandingFooter />
    </>
  );
}
