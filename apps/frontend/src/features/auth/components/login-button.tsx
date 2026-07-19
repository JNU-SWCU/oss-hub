'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchMe, githubLoginPath, logout } from '../api';
import { applyLogoutFailure, applyLogoutSuccess } from '../session-state';
import type { Me } from '../types';

export function LoginButton() {
  const [me, setMe] = useState<Me | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchMe()
      .then((user) => {
        if (active) setMe(user);
      })
      .catch(() => {
        if (active) setMe(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (isLoading) {
    return null;
  }

  if (me) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void logout()
              .then((result) => {
                const next = applyLogoutSuccess({ me, logoutError }, result);
                if (next.me === null) {
                  // 로그아웃 확정: 전체 내비게이션으로 모든 세션 소비자(예:
                  // RoleHomeNavLink)를 초기화하고 랜딩(`/`)에 착지한다.
                  window.location.assign('/');
                  return;
                }
                setMe(next.me);
                setLogoutError(next.logoutError);
              })
              .catch(() => {
                const next = applyLogoutFailure({ me, logoutError });
                setMe(next.me);
                setLogoutError(next.logoutError);
              });
          }}
        >
          {me.login} · 로그아웃
        </Button>
        {logoutError ? (
          <span role="alert" className="text-xs text-destructive">
            {logoutError}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <Button asChild variant="ghost">
      <a href={githubLoginPath}>GitHub으로 로그인</a>
    </Button>
  );
}
