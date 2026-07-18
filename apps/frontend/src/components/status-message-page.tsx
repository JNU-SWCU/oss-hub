import * as React from "react"

import { cn } from "@/lib/utils"

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
}: React.ComponentProps<"div"> & {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  header?: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div
      data-slot="status-message-page"
      className={cn("grid min-h-dvh grid-rows-[auto_1fr_auto] gap-4 p-4", className)}
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
          <div data-slot="status-message-page-icon" className="text-muted-foreground">
            {icon}
          </div>
        ) : null}
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
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
  )
}

export { StatusMessagePage }
