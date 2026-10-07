import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface SkeletonProps {
  readonly label: string;
  readonly children: ReactNode;

  readonly className?: string;
}

export function Skeleton({ label, children, className }: SkeletonProps) {
  return (
    <>
      <span className="sr-only" aria-live="polite" role="status">
        {label}
      </span>
      <div aria-busy="true" data-slot="skeleton" className={cn(className)}>
        {children}
      </div>
    </>
  );
}

export interface SkeletonBlockProps {
  readonly className?: string;
}

export function SkeletonBlock({ className }: SkeletonBlockProps) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton-block"
      className={cn(
        'animate-pulse bg-muted motion-reduce:animate-none',
        className,
      )}
    />
  );
}
