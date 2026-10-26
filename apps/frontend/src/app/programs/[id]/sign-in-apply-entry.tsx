import { GitHubSignInLink } from '@/features/auth/components/github-sign-in-link';
import { loginDestination } from '@/features/auth/login-destination';

export function renderSignInApplyEntry(applyHref: string) {
  return (
    <GitHubSignInLink returnTo={loginDestination(applyHref)}>
      신청하기
    </GitHubSignInLink>
  );
}
