import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { OnboardingProgress, type OnboardingStep } from './onboarding-progress';
import { SignupStarfield } from './signup-starfield';

export function SignupStage({
  step,
  children,
  className,
  contentClassName,
}: {
  readonly step?: OnboardingStep;
  readonly children: ReactNode;
  readonly className?: string;

  readonly contentClassName?: string;
}) {
  return (
    <div
      data-surface="inverted"
      className={cn('relative flex w-full flex-1', className)}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(70rem 50rem at 50% 42%, color-mix(in oklch, var(--cosmos-repository) 11%, transparent), transparent 70%)',
        }}
      />
      <SignupStarfield />

      <OnboardingProgress current={step} />

      <main
        id="signup-main"
        className={cn(
          'relative z-10 flex w-full max-w-2xl flex-col justify-center gap-8 py-16 pr-6 sm:pr-12',
          contentClassName,
        )}
      >
        {children}
      </main>
    </div>
  );
}
