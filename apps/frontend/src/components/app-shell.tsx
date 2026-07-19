import * as React from 'react';

import { cn } from '@/lib/utils';

interface AppShellProps extends React.ComponentProps<'div'> {
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * 전체 화면 뼈대(viewport-shell 패턴) — 헤더(보통 NavBar)가 고정되고
 * 본문 영역만 뷰포트 안에서 스크롤된다. footer는 선택이다.
 */
function AppShell({
  header,
  footer,
  className,
  children,
  ...props
}: AppShellProps) {
  return (
    <div
      data-slot="app-shell"
      className={cn(
        'grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto]',
        className,
      )}
      {...props}
    >
      {header ? (
        <header data-slot="app-shell-header" className="row-start-1 shrink-0">
          {header}
        </header>
      ) : null}
      <main
        data-slot="app-shell-body"
        className="row-start-2 min-h-0 overflow-y-auto"
      >
        {children}
      </main>
      {footer ? (
        <footer data-slot="app-shell-footer" className="row-start-3 shrink-0">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}

export { AppShell };
export type { AppShellProps };
