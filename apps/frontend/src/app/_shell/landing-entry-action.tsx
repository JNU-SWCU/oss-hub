'use client';

import Link from 'next/link';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SIGNUP_ENTRY } from '@/features/auth/signup-entry-link';
import { resolveSessionEntry } from './role-home-link';
import { EMPTY_MEMBER_ACCESS, type MemberAccess } from './member-access';
import type { SessionStatus } from './use-session-role';

interface LandingEntryActionViewProps {
  readonly status: SessionStatus;
  readonly access?: MemberAccess;

  readonly isProfileComplete: boolean;
  readonly hasAuthError?: boolean;
  readonly inverted?: boolean;
}

export function LandingEntryActionView({
  status,
  access,
  isProfileComplete,
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

  const signupButton = (
    <Button asChild className={className} size="lg">
      <Link href={SIGNUP_ENTRY.href}>
        {hasAuthError ? '로그인 다시 시도' : SIGNUP_ENTRY.label}
        <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  );

  if (status === 'anonymous') return signupButton;

  if (status === 'error') {
    return (
      <div className="flex flex-col items-stretch gap-2 sm:items-start">
        {signupButton}
        <p
          className={cn(
            'max-w-sm break-keep text-xs leading-relaxed',

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

  const destination = resolveSessionEntry(
    status,
    access ?? EMPTY_MEMBER_ACCESS,
    isProfileComplete,
  );
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
