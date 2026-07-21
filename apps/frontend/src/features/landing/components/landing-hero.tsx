import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface LandingHeroProps {
  authErrorMessage?: string;
  primaryAction: ReactNode;
}

export function LandingHero({
  authErrorMessage,
  primaryAction,
}: LandingHeroProps) {
  return (
    <section
      aria-labelledby="landing-hero-heading"
      className="relative overflow-hidden border-b border-border bg-gradient-to-b from-primary/[0.06] via-background to-background"
    >
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-20 sm:px-6 md:py-28 lg:px-8">
        <span className="animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-700 motion-reduce:animate-none rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium tracking-wide text-primary">
          OSS HUB
        </span>

        <h1
          id="landing-hero-heading"
          className="animate-in fade-in slide-in-from-bottom-6 fill-mode-both delay-100 duration-700 motion-reduce:animate-none max-w-3xl text-3xl font-bold tracking-tight text-foreground md:text-5xl"
        >
          경진대회부터 해커톤까지, 오픈소스 프로그램을 한 곳에서
        </h1>

        <p className="animate-in fade-in slide-in-from-bottom-6 fill-mode-both delay-200 duration-700 motion-reduce:animate-none max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
          OSS Hub는 학생과 교직원이 오픈소스 프로그램을 함께 열고 참여하는
          공간입니다. 프로그램을 둘러보고, 지원하고, 진행 상황을 확인하세요.
        </p>

        {authErrorMessage ? (
          <Alert variant="destructive" className="max-w-2xl">
            <AlertDescription>{authErrorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="animate-in fade-in slide-in-from-bottom-6 fill-mode-both delay-300 duration-700 motion-reduce:animate-none flex flex-wrap items-center gap-4 pt-2">
          {primaryAction}
          <a
            href="#program-types"
            className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            프로그램 유형 살펴보기
          </a>
        </div>
      </div>
    </section>
  );
}
