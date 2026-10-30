import { redirect } from 'next/navigation';
import {
  readReturnTo,
  RETURN_TO_PARAM,
} from '@/features/auth/login-destination';

export default async function SignupPage({
  searchParams,
}: {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}) {
  const returnTo = readReturnTo(await searchParams);
  redirect(
    returnTo
      ? `/?${new URLSearchParams({ [RETURN_TO_PARAM]: returnTo }).toString()}`
      : '/',
  );
}
