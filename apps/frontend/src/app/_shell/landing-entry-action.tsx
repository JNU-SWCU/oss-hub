'use client';

import Link from 'next/link';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SIGNUP_ENTRY } from '@/features/auth/signup-entry-link';
import { resolveSessionEntry } from './role-home-link';
import type { AppRole } from './role';
import type { SessionStatus } from './use-session-role';

interface LandingEntryActionViewProps {
  readonly status: SessionStatus;
  readonly role: AppRole | null;
  readonly hasAuthError?: boolean;
  readonly inverted?: boolean;
}

export function LandingEntryActionView({
  status,
  role,
  hasAuthError = false,
  inverted = false,
}: LandingEntryActionViewProps) {
  const className = cn(
    'min-h-11',
    inverted && 'bg-background text-primary hover:bg-background/90',
  );

  if (status === 'loading') {
    return (
      <Button className={className} size="lg" disabled aria-busy="true">
        <LoaderCircle className="animate-spin" aria-hidden="true" />
        세션 확인 중
      </Button>
    );
  }

  // GitHub으로 바로 던지지 않고 `/signup`을 거친다 — 무슨 일이 일어나는지,
  // GitHub 계정이 없으면 어떻게 하는지를 말할 자리가 그 화면이다.
  const signupButton = (
    <Button asChild className={className} size="lg">
      <Link href={SIGNUP_ENTRY.href}>
        {hasAuthError ? '로그인 다시 시도' : SIGNUP_ENTRY.label}
        <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  );

  if (status === 'anonymous') return signupButton;

  /**
   * 세션 조회 실패. 역할을 모르니 대시보드로 보낼 수는 없지만, 그렇다고 버튼을
   * 지우면 첫 화면만 보고 떠나는 방문자에게는 진입로가 아예 사라진다 — 히어로의
   * 주 버튼이 통째로 없어지고 헤더에도 남지 않아(`features/auth/session-view.ts`가
   * 실패를 감춘다) 첫 화면에는 "프로그램 둘러보기" 하나만 남는다. 유일한 복구
   * 수단인 SessionError 배너는 문서 5,400px 지점이라 화면 여섯 개를 내려야 보인다.
   *
   * 그래서 진입 수단만큼은 비로그인과 같은 `/signup` 버튼을 그대로 내준다 —
   * 진입점이 둘이어도 목적지는 하나여야 하므로 위 `signupButton`을 재사용한다.
   *
   * 다만 버튼만 비로그인과 똑같이 두면 "로그아웃됐다"로 읽힌다. 실제로는 조회가
   * 실패했을 뿐 로그인 상태일 수 있고, 상태와 화면이 어긋나면 사용자는 재시도할
   * 생각을 못 한다 — SessionError 주석이 지적하는 바로 그 함정이다. 그래서 버튼
   * 아래에 실패 사실과 "로그아웃된 것은 아니다"를 SessionError와 같은 판단·같은
   * 어조로 적어 둔다.
   */
  if (status === 'error') {
    return (
      <div className="flex flex-col items-stretch gap-2 sm:items-start">
        {signupButton}
        <p
          className={cn(
            'max-w-sm break-keep text-xs leading-relaxed',
            // 어두운 표면(우주 여정·하단 CTA)에서는 `--muted-foreground`가 묻힌다.
            inverted ? 'text-hero-muted' : 'text-muted-foreground',
          )}
        >
          로그인 정보를 확인하지 못했습니다. 일시적인 통신 문제일 수 있어
          로그아웃된 것은 아닙니다. 잠시 뒤 새로고침하거나, 위 버튼으로 다시
          로그인해 주세요.
        </p>
      </div>
    );
  }

  const destination = resolveSessionEntry(status, role);
  if (!destination) return null;

  return (
    <Button asChild className={className} size="lg">
      <Link href={destination.href}>
        {destination.label}
        <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  );
}
