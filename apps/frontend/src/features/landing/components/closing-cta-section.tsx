import type { ReactNode } from 'react';

export function ClosingCtaSection({ action }: { readonly action: ReactNode }) {
  return (
    <section
      aria-labelledby="closing-cta-heading"
      className="bg-hero-via text-hero-foreground"
    >
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-6 py-16 sm:px-8 lg:py-20">
        <h2
          id="closing-cta-heading"
          className="break-keep text-3xl font-bold tracking-tight"
        >
          프로그램 참여와 제출 현황을 확인하세요
        </h2>
        <p className="max-w-xl break-keep text-sm leading-relaxed text-hero-muted">
          GitHub 계정으로 로그인하면 내 역할에 맞는 대시보드로 이동합니다.
        </p>
        {action}
      </div>
    </section>
  );
}
