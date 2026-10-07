import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function FadeUp({
  children,
  delayMs,
}: {
  readonly children: ReactNode;
  readonly delayMs: number;
}): ReactElement {
  return (
    <div
      className={cn(
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2',
        'motion-safe:duration-500 motion-reduce:animate-none',
      )}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}
