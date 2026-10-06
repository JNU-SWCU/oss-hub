'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { logout } from '../api';
import { SIGNUP_ENTRY, shouldShowEntryLink } from '../signup-entry-link';
import { refreshSession } from '../session-store';
import { toAccountMenuSession } from '../session-view';
import { useSession } from '../use-session';
import { applyLogoutFailure, applyLogoutSuccess } from '../session-state';
import type { AuthSession, Me } from '../types';
import {
  clearLoginDestination,
  getLoginDestinationStorage,
  signupForDestination,
} from '../login-destination';

interface LoginButtonViewProps {
  readonly session: AuthSession | null;

  readonly pathname: string;
  readonly accountRoles?: string;
  readonly logoutError: string | null;
  readonly menuOpen: boolean;
  readonly onMenuOpenChange: (open: boolean) => void;
  readonly onLogout: () => void;
}

function AccountAvatar({ user }: { readonly user: Me }) {
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        width={24}
        height={24}
        className="size-6 rounded-full"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
    >
      {user.nickname.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function LoginButtonView({
  session,
  pathname,
  accountRoles,
  logoutError,
  menuOpen,
  onMenuOpenChange,
  onLogout,
}: LoginButtonViewProps) {
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function handlePointerDown(event: MouseEvent): void {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onMenuOpenChange(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onMenuOpenChange(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen, onMenuOpenChange]);

  if (session === null) {
    return null;
  }

  switch (session.isAuthenticated) {
    case false:
      if (!shouldShowEntryLink(SIGNUP_ENTRY.href, pathname)) {
        return null;
      }
      return (
        <Button asChild variant="ghost">
          <Link
            href={signupForDestination(pathname)}
            aria-label={SIGNUP_ENTRY.label}
          >
            <span className="sm:hidden">{SIGNUP_ENTRY.compactLabel}</span>
            <span className="hidden sm:inline">{SIGNUP_ENTRY.label}</span>
          </Link>
        </Button>
      );
    case true: {
      const { user } = session;
      return (
        <div ref={containerRef} className="relative flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            aria-label={`${user.nickname} 계정 메뉴${accountRoles ? `, ${accountRoles}` : ''}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => onMenuOpenChange(!menuOpen)}
          >
            <AccountAvatar user={user} />
            <span className="hidden max-w-28 truncate md:inline">
              {user.nickname}
            </span>
          </Button>
          {menuOpen ? (
            <div
              id={menuId}
              role="menu"
              aria-label="계정 메뉴"

              data-surface="default"
              className="absolute top-full right-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-lg"
            >
              <div className="border-b border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">로그인 계정</p>
                <p className="truncate text-sm font-semibold">
                  {user.nickname}
                </p>
                {accountRoles ? (
                  <p className="break-keep text-xs text-muted-foreground">
                    {accountRoles}
                  </p>
                ) : null}
              </div>

              <a
                role="menuitem"
                href="/settings"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => onMenuOpenChange(false)}
              >
                설정
              </a>
              <Button
                type="button"
                role="menuitem"
                variant="bare"
                size="content"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onMenuOpenChange(false);
                  onLogout();
                }}
              >
                로그아웃
              </Button>
            </div>
          ) : null}
          {logoutError ? (
            <span role="alert" className="text-xs text-destructive">
              {logoutError}
            </span>
          ) : null}
        </div>
      );
    }
    default: {
      const exhaustive: never = session;
      return exhaustive;
    }
  }
}

export function LoginButton({
  accountRoles,
}: { readonly accountRoles?: string } = {}) {
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const sessionState = useSession();
  const session = toAccountMenuSession(sessionState);
  const pathname = usePathname();

  return (
    <LoginButtonView
      session={session}
      pathname={pathname}
      accountRoles={accountRoles}
      logoutError={logoutError}
      menuOpen={menuOpen}
      onMenuOpenChange={setMenuOpen}
      onLogout={() => {
        if (!session?.isAuthenticated) return;

        const me = session.user;
        void logout()
          .then((result) => {
            const next = applyLogoutSuccess({ me, logoutError }, result);
            if (next.me === null) {
              clearLoginDestination(getLoginDestinationStorage());

              window.location.assign('/');
              return;
            }

            refreshSession();
            setLogoutError(next.logoutError);
          })
          .catch(() => {
            const next = applyLogoutFailure({ me, logoutError });
            setLogoutError(next.logoutError);
          });
      }}
    />
  );
}
