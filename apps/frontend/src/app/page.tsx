import { AUTH_ERROR_MESSAGE, hasAuthError } from '@/features/auth/auth-error';
import { ClosingCtaSection } from '@/features/landing/components/closing-cta-section';
import { LandingHero } from '@/features/landing/components/landing-hero';
import { ProgramTypeSection } from '@/features/landing/components/program-type-section';
import { RolePathSection } from '@/features/landing/components/role-path-section';

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
      <LandingHero authErrorMessage={authErrorMessage} />
      <ProgramTypeSection />
      <RolePathSection />
      <ClosingCtaSection />
    </main>
  );
}
