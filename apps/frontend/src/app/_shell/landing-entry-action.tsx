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
   * 조회 실패에서도 진입 수단은 비로그인과 같다 — 위 `signupButton`을 재사용하고,
   * "로그아웃됐다"로 읽히지 않게 실패 사실을 아래에 함께 적는다.
   * 근거: `docs/design.md`의 `세션별 주 CTA`.
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
