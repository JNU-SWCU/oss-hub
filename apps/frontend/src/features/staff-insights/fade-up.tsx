import type { ReactElement, ReactNode } from 'react';

/**
 * Amicro fade-up entrance (copy-to-code). Quantity stays in the child;
 * this wrapper only delays opacity/translate. Honors reduced motion.
 */
export function FadeUp({
  children,
  delayMs,
}: {
  readonly children: ReactNode;
  readonly delayMs: number;
}): ReactElement {
  return (
    <div
      className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-reduce:animate-none"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}
