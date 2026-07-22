import { AUTH_ERROR_MESSAGE, hasAuthError } from '@/features/auth/auth-error';
import { ClosingCtaSection } from '@/features/landing/components/closing-cta-section';
import { LandingHero } from '@/features/landing/components/landing-hero';
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

  return (
    <main>
      {/* #136: `/`는 로그인 상태와 무관하게 항상 랜딩을 렌더한다. 자동
          역할 홈 리다이렉트(#144)는 back-trap 문제로 제거됐다 — 역할 홈
          진입은 nav의 RoleHomeNavLink로 대체됐다. */}
      <LandingHero
        authErrorMessage={authErrorMessage}
        primaryAction={
          <LandingEntryAction hasAuthError={Boolean(authErrorMessage)} />
        }
      />
      <ProgramTypeSection />
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
  );
}
