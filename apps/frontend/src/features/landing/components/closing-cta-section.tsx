import type { ReactNode } from 'react';

export function ClosingCtaSection({ action }: { readonly action: ReactNode }) {
  return (
    <section className="bg-primary text-primary-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-8 py-20">
        <h2 className="text-3xl font-bold tracking-tight">
          지금 GitHub 계정으로 시작하세요
        </h2>
        <p className="max-w-xl text-sm leading-relaxed text-primary-foreground/80">
          로그인 후 나에게 맞는 오픈소스 프로그램을 찾아보세요.
        </p>
        {action}
      </div>
    </section>
  );
}
