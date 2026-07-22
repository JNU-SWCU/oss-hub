'use client';

import Link from 'next/link';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { githubLoginPath } from '@/features/landing/api';
import { cn } from '@/lib/utils';
import { resolveSessionEntry } from './role-home-link';
import type { AppRole } from './role';
import { useSessionRole, type SessionStatus } from './use-session-role';

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

  if (status === 'anonymous') {
    return (
      <Button asChild className={className} size="lg">
        <a href={githubLoginPath}>
          {hasAuthError ? 'GitHub 로그인 다시 시도' : 'GitHub으로 로그인'}
          <ArrowRight aria-hidden="true" />
        </a>
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

interface LandingEntryActionProps {
  readonly hasAuthError?: boolean;
  readonly inverted?: boolean;
}

export function LandingEntryAction(props: LandingEntryActionProps) {
  const { status, role } = useSessionRole();
  return <LandingEntryActionView {...props} status={status} role={role} />;
}
