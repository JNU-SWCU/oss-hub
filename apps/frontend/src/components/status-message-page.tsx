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
 * 화면 하나를 통째로 대신하는 단일 메시지 뼈대 — 빈 상태·에러·404류 전면 안내에
 * 재사용한다.
 *
 * 높이를 뷰포트가 아니라 **반 뷰포트**(`min-h-[50svh]`)로 잡는다. 이 부품은 언제나
 * 셸 안에 선다 — 모든 라우트가 `app/layout.tsx` → `AppFrame`을 거치고, 그 셸이 이미
 * `min-h-dvh`로 뷰포트를 채운 뒤 그 위에 머리글을 얹는다. 여기서 다시 한 뷰포트를
 * 요구하면 두 번 세는 셈이라 머리글 높이만큼 **끝까지 내려도 아무것도 없는 빈
 * 스크롤**이 남았다(#598, 측정: 1440·768 각 56px · 375 61px).
 *
 * 100%로 물려받지 못하는 이유는 부모(`ProductShell`의 본문 칸)가 flex 자식이라
 * 높이가 확정값이 아니어서다 — 백분율 최소 높이가 0으로 접혀 내용이 머리글 바로
 * 아래에 붙는다(chromium 실측: 세 폭 모두 높이 163~199px). 그래서 같은 처지의 전면
 * 안내인 `app/_shell/session-error.tsx`·`access-denied.tsx`가 이미 쓰는
 * `min-h-[50svh]`를 그대로 따른다. 내용이 그보다 길면 최소 높이라 알아서 늘어난다.
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
        'grid min-h-[50svh] grid-rows-[auto_1fr_auto] gap-4 p-4',
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
