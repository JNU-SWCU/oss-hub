import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * 프로그램·신청 상태 뱃지. 상태→색 매핑은 globals.css의 semantic
 * `--status-*` 토큰에 고정돼 있고(하드코딩 색상 금지), 실제 상태 문자열은
 * children으로 호출부가 주입한다.
 */
const statusBadgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        recruiting: "bg-status-recruiting-bg text-status-recruiting-fg",
        closed: "bg-status-closed-bg text-status-closed-fg",
        pending: "bg-status-pending-bg text-status-pending-fg",
        approved: "bg-status-approved-bg text-status-approved-fg",
        rejected: "bg-status-rejected-bg text-status-rejected-fg",
      },
    },
    defaultVariants: {
      variant: "recruiting",
    },
  }
)

function StatusBadge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statusBadgeVariants>) {
  return (
    <span
      data-slot="status-badge"
      data-variant={variant}
      className={cn(statusBadgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { StatusBadge, statusBadgeVariants }
