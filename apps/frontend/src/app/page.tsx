import { AUTH_ERROR_MESSAGE, hasAuthError } from '@/features/auth/auth-error';
import { LoginButton } from '@/features/auth/components/login-button';

interface HomePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = await searchParams;
  return (
    <main>
      <h1>OSS Hub</h1>
      <p>오픈소스 활동을 함께 관리하는 공간입니다.</p>
      {hasAuthError(resolvedSearchParams) ? (
        <p role="alert">{AUTH_ERROR_MESSAGE}</p>
      ) : null}
      <LoginButton />
    </main>
  );
}
