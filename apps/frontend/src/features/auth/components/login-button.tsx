'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchSession, githubLoginPath, logout } from '../api';
import { applyLogoutFailure, applyLogoutSuccess } from '../session-state';
import type { AuthSession, Me } from '../types';

interface LoginButtonViewProps {
  readonly session: AuthSession | null;
  readonly logoutError: string | null;
  readonly menuOpen: boolean;
  readonly onMenuOpenChange: (open: boolean) => void;
  readonly onLogout: () => void;
}

function AccountAvatar({ user }: { readonly user: Me }) {
  if (user.avatarUrl) {
    return (
      // GitHub avatar CDN — next/image remotePatterns 없이 표시한다.
      // eslint-disable-next-line @next/next/no-img-element -- 외부 avatar URL
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
      return (
        <Button asChild variant="ghost">
          <a href={githubLoginPath}>GitHub으로 로그인</a>
        </Button>
      );
    case true: {
      const { user } = session;
      return (
        <div ref={containerRef} className="relative flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            aria-label={`${user.nickname} 계정 메뉴`}
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
              // 반전 표면(랜딩 nav) 안에 중첩될 수 있는 밝은 패널 — data-surface="default"로
              // globals.css의 리셋 스코프를 걸어 배경·텍스트 색을 :root 기준으로 되돌린다.
              data-surface="default"
              className="absolute top-full right-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-lg"
            >
              <div className="border-b border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">Signed in as</p>
                <p className="truncate text-sm font-semibold">
                  {user.nickname}
                </p>
              </div>
              <a
                role="menuitem"
                href="/settings"
                className="block px-3 py-2 text-sm hover:bg-muted"
                onClick={() => onMenuOpenChange(false)}
              >
                Settings
              </a>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onMenuOpenChange(false);
                  onLogout();
                }}
              >
                Sign out
              </button>
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

export function LoginButton() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetchSession()
      .then((nextSession) => {
        if (active) setSession(nextSession);
      })
      .catch(() => {
        if (active) setSession({ isAuthenticated: false });
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <LoginButtonView
      session={session}
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
              // 로그아웃 확정: 전체 내비게이션으로 모든 세션 소비자(예:
              // RoleHomeNavLink)를 초기화하고 랜딩(`/`)에 착지한다.
              window.location.assign('/');
              return;
            }
            setSession({ isAuthenticated: true, user: next.me });
            setLogoutError(next.logoutError);
          })
          .catch(() => {
            const next = applyLogoutFailure({ me, logoutError });
            setSession({ isAuthenticated: true, user: me });
            setLogoutError(next.logoutError);
          });
      }}
    />
  );
}
