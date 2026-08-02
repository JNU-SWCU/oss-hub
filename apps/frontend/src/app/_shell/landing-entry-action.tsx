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
  if (status === 'anonymous') {
    return (
      <Button asChild className={className} size="lg">
        <Link href={SIGNUP_ENTRY.href}>
          {hasAuthError ? '로그인 다시 시도' : SIGNUP_ENTRY.label}
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
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
