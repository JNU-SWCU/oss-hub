import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import {
  githubAccountChoicePath,
  githubLoginPath,
} from '@/features/auth/login-paths';
import {
  getLoginDestinationStorage,
  rememberLoginDestination,
} from '@/features/auth/login-destination';

interface GitHubSignInLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  readonly returnTo?: string | null;
  readonly selectAccount?: boolean;
  readonly children: ReactNode;
}

export function GitHubSignInLink({
  returnTo = null,
  selectAccount = false,
  children,
  onClick,
  ...rest
}: GitHubSignInLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    rememberLoginDestination(getLoginDestinationStorage(), returnTo);
  }

  return (
    <a
      {...rest}
      href={selectAccount ? githubAccountChoicePath : githubLoginPath}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
