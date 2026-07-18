import * as React from "react"

import { cn } from "@/lib/utils"

interface EmptyStateProps extends React.ComponentProps<"div"> {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}

/**
 * 목록·그리드가 비었을 때의 안내 화면.
 * StyleGallery stack(수직 리듬) + center(폭 제한·가운데 정렬) 패턴 조합.
 */
function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "mx-auto grid max-w-sm justify-items-center gap-2 py-12 text-center",
        className
      )}
      {...props}
    >
      {icon ? (
        <div data-slot="empty-state-icon" aria-hidden="true" className="text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <p className="font-heading text-base font-medium text-foreground">{title}</p>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export { EmptyState }
export type { EmptyStateProps }
