'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RouteNoticeProps {
  readonly title: string;
  readonly description: string;
  readonly actions: ReactNode;

  readonly code?: string;
  readonly className?: string;
}

export function RouteNotice({
  title,
  description,
  actions,
  code,
  className,
}: RouteNoticeProps) {
  return (
    <main
      data-slot="route-notice"
      className={cn(
        'flex min-h-[50svh] flex-col items-center justify-center gap-4 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mx-auto max-w-md break-keep text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      <div
        data-slot="route-notice-actions"
        className="flex flex-wrap justify-center gap-2"
      >
        {actions}
      </div>
      {code ? (
        <p
          data-slot="route-notice-code"
          className="text-xs text-muted-foreground"
        >
          {code}
        </p>
      ) : null}
    </main>
  );
}

export function PreviousPageButton() {
  const router = useRouter();

  return (
    <Button
      type="button"
      className="min-h-11"
      variant="outline"
      size="sm"
      onClick={() => router.back()}
    >
      이전 화면
    </Button>
  );
}

export type { RouteNoticeProps };
