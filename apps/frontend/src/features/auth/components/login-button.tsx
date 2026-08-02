'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { logout } from '../api';
import { LOGOUT_NOTICE_PARAM } from '../logout-notice';
import { SIGNUP_ENTRY, shouldShowEntryLink } from '../signup-entry-link';
import { refreshSession } from '../session-store';
import { toAccountMenuSession } from '../session-view';
import { useSession } from '../use-session';
import { applyLogoutFailure, applyLogoutSuccess } from '../session-state';
import type { AuthSession, Me } from '../types';

interface LoginButtonViewProps {
  readonly session: AuthSession | null;
  /** 지금 보고 있는 경로. 목적지와 같으면 진입 버튼을 내지 않는다. */
  readonly pathname: string;
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
  pathname,
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
      // 헤더도 랜딩 본문과 같은 `/signup`으로 보낸다. 여기서만 OAuth로 직행하면
      // 헤더를 눌러 들어온 방문자는 랜딩에서 막 없앤 막다른 길 — 무슨 일이
      // 일어나는지도, GitHub 계정이 없을 때 어디로 가야 하는지도 듣지 못한 채
      // GitHub으로 던져지는 — 을 그대로 다시 만난다. 진입점이 둘이면 목적지는
      // 하나여야 한다.
      //
      // 앱 내부 이동이므로 `Link`다. `<a href>`는 backend 경로(OAuth 시작)를 가리킬
      // 때만 맞고, 그 자리는 이제 `/signup` 화면 하나뿐이다.
      // 이미 그 화면에 서 있으면 버튼을 내지 않는다 — 눌러도 제자리라 고장으로 읽힌다.
      if (!shouldShowEntryLink(SIGNUP_ENTRY.href, pathname)) {
        return null;
      }
      return (
        <Button asChild variant="ghost">
          <Link href={SIGNUP_ENTRY.href} aria-label={SIGNUP_ENTRY.label}>
            {/* nav actions는 `shrink-0`이라 좁은 화면에서 메뉴를 파고든다 —
                640px 미만에서는 짧은 라벨을 쓴다(role-home-link의 nav 링크와 동일). */}
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
                <p className="text-xs text-muted-foreground">로그인 계정</p>
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
                설정
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
                로그아웃
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
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // 자체 조회를 두지 않고 공유 세션 저장소를 읽는다. 헤더와 본문이 각자 상태를
  // 들고 있으면 본문에서 재시도해 복구해도 헤더는 갱신되지 않아 한 화면에서
  // 인증 표시가 서로 모순된다.
  const sessionState = useSession();
  const session = toAccountMenuSession(sessionState);
  const pathname = usePathname();

  return (
    <LoginButtonView
      session={session}
      pathname={pathname}
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
              // 표식을 붙여 랜딩이 로그아웃 완료와 계정 전환 방법을 안내하게 한다 —
              // 안내가 없으면 사용자는 다시 로그인했을 때 같은 계정으로 들어오는 것을
              // 보고 로그아웃이 실패한 줄로 읽는다.
              window.location.assign(`/?${LOGOUT_NOTICE_PARAM}=1`);
              return;
            }
            // 로그아웃이 확정되지 않았다면 세션은 아직 살아 있다. 지역 상태를
            // 되돌리는 대신 공유 저장소를 다시 읽어 모든 소비자를 함께 맞춘다.
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
