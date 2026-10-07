import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function SignupEyebrow({ children }: { readonly children: ReactNode }) {
  return (
    <span
      className={cn(
        'w-fit rounded-full border border-cosmos-border bg-cosmos-muted/8 px-3.5 py-1.5',
        'text-xs font-semibold tracking-[0.08em] text-cosmos-muted',
      )}
    >
      {children}
    </span>
  );
}

export function SignupTitle({ children }: { readonly children: ReactNode }) {
  return (
    <h1 className="font-heading text-3xl leading-tight font-extrabold tracking-tight text-balance text-cosmos-copy sm:text-4xl">
      {children}
    </h1>
  );
}

export function SignupLede({ children }: { readonly children: ReactNode }) {
  return (
    <p className="max-w-prose text-body break-keep text-cosmos-muted">
      {children}
    </p>
  );
}

export const signupPrimaryClassName =
  'bg-cosmos-copy text-primary hover:bg-cosmos-copy/90';
