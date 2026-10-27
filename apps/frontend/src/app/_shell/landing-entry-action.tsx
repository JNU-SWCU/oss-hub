'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GitHubMark } from '@/components/github-mark';
import { cn } from '@/lib/utils';
import { GitHubSignInLink } from '@/features/auth/components/github-sign-in-link';
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

  const signInButton = (
    <Button asChild className={className} size="lg">
      <GitHubSignInLink
        returnTo={null}
        aria-label={
          hasAuthError ? 'GitHub으로 다시 시도' : 'GitHub으로 시작하기'
        }
      >
        <GitHubMark className="size-4" />
        {hasAuthError ? '다시 시도' : '시작하기'}
      </GitHubSignInLink>
    </Button>
  );

  if (status === 'loading' || status === 'anonymous') return signInButton;

  if (status === 'error') {
    return (
      <div className="flex flex-col items-stretch gap-2 sm:items-start">
        {signInButton}
        <p
          className={cn(
            'max-w-sm break-keep text-xs leading-relaxed',

            inverted ? 'text-hero-muted' : 'text-muted-foreground',
          )}
        >
          로그인 상태를 확인하지 못했습니다. 잠시 뒤 새로고침하거나 다시
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
