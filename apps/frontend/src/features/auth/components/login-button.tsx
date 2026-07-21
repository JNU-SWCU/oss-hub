'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchSession, githubLoginPath, logout } from '../api';
import { applyLogoutFailure, applyLogoutSuccess } from '../session-state';
import type { AuthSession } from '../types';

interface LoginButtonViewProps {
  readonly session: AuthSession | null;
  readonly logoutError: string | null;
  readonly onLogout: () => void;
}

export function LoginButtonView({
  session,
  logoutError,
  onLogout,
}: LoginButtonViewProps) {
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
    case true:
      return (
        <>
          <Button type="button" variant="ghost" onClick={onLogout}>
            {session.user.login} · 로그아웃
          </Button>
          {logoutError ? (
            <span role="alert" className="text-xs text-destructive">
              {logoutError}
            </span>
          ) : null}
        </>
      );
    default: {
      const exhaustive: never = session;
      return exhaustive;
    }
  }
}

export function LoginButton() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);

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
