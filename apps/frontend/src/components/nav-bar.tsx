import Link from "next/link"
import * as React from "react"

import { cn } from "@/lib/utils"

export interface NavItem {
  label: string
  href: string
}

/**
 * 상단 내비게이션. 메뉴 구성은 호출부가 `items`로 주입하는 nav-config 방식이다 —
 * 이 컴포넌트는 role prop을 받지 않고 역할 분기 로직도 갖지 않는다.
 * 역할별 메뉴 계산은 호출부(세션을 아는 쪽)의 책임이다.
 */
function NavBar({
  items,
  brand,
  actions,
  className,
  ...props
}: Omit<React.ComponentProps<"nav">, "children"> & {
  items: NavItem[]
  brand?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <nav
      data-slot="nav-bar"
      className={cn(
        "flex h-14 items-center gap-4 border-b border-border bg-background px-4",
        className
      )}
      {...props}
    >
      {brand ? (
        <div
          data-slot="nav-bar-brand"
          className="font-heading text-base font-semibold"
        >
          {brand}
        </div>
      ) : null}
      <ul data-slot="nav-bar-items" className="flex flex-1 items-center gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="rounded-md px-2.5 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
      {actions ? (
        <div data-slot="nav-bar-actions" className="flex items-center gap-2">
          {actions}
        </div>
      ) : null}
    </nav>
  )
}

export { NavBar }
