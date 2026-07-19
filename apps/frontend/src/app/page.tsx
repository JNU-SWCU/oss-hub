import { AUTH_ERROR_MESSAGE, hasAuthError } from '@/features/auth/auth-error';
import { ClosingCtaSection } from '@/features/landing/components/closing-cta-section';
import { LandingHero } from '@/features/landing/components/landing-hero';
import { ProgramTypeSection } from '@/features/landing/components/program-type-section';
import { RolePathSection } from '@/features/landing/components/role-path-section';
import { RoleHomeRedirect } from './_shell/role-home-redirect';

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
      {/* #136: 로그인 상태(role 확정)로 랜딩에 들어오면 자기 역할 홈으로 이동.
          비로그인 다수가 보는 랜딩 본문은 세션 확인과 무관하게 그대로 렌더한다. */}
      <RoleHomeRedirect />
      <LandingHero authErrorMessage={authErrorMessage} />
      <ProgramTypeSection />
      <RolePathSection />
      <ClosingCtaSection />
    </main>
  );
}
