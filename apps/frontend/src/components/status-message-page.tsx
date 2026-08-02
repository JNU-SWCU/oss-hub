import * as React from 'react';

import { cn } from '@/lib/utils';

interface StatusMessagePageProps extends Omit<
  React.ComponentProps<'div'>,
  'title'
> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * 뷰포트 전체를 덮는 단일 메시지 뼈대(cover 패턴) — 빈 상태·에러·404류 전면
 * 안내 화면에 재사용한다.
 */
function StatusMessagePage({
  icon,
  title,
  description,
  action,
  header,
  footer,
  className,
  ...props
}: StatusMessagePageProps) {
  return (
    <div
      data-slot="status-message-page"
      className={cn(
        'grid min-h-dvh grid-rows-[auto_1fr_auto] gap-4 p-4',
        className,
      )}
      {...props}
    >
      {header ? (
        <header data-slot="status-message-page-header" className="row-start-1">
          {header}
        </header>
      ) : null}
      <main
        data-slot="status-message-page-body"
        className="row-start-2 flex flex-col items-center justify-center gap-3 text-center"
      >
        {icon ? (
          <div
            data-slot="status-message-page-icon"
            aria-hidden="true"
            className="text-muted-foreground"
          >
            {icon}
          </div>
        ) : null}
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          {title}
        </h1>
        {description ? (
          // 폭을 묶지 않으면 넓은 화면에서 한 줄이 뷰포트 끝까지(1000px 넘게) 늘어나
          // 다음 줄 첫 글자를 눈으로 되찾기 어렵다. 같은 처지의 전면 안내인
          // `app/_shell/session-error.tsx`·`access-denied.tsx`가 이미 쓰는 폭을 그대로
          // 따라, 이 부품을 함께 쓰는 화면들이 서로 다른 폭으로 갈라지지 않게 한다.
          //
          // `w-full`이 아니라 최대 폭만 건다 — 부모가 `items-center`라 문단은 제 내용
          // 만큼만 차지하고, 그래서 짧은 문구도 가운데 정렬이 유지되며 좁은 화면에서
          // 양옆에 빈 폭이 남지 않는다.
          <p className="mx-auto max-w-md break-keep text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
        {action ? (
          <div data-slot="status-message-page-action" className="mt-2">
            {action}
          </div>
        ) : null}
      </main>
      {footer ? (
        <footer data-slot="status-message-page-footer" className="row-start-3">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}

export { StatusMessagePage };
export type { StatusMessagePageProps };
