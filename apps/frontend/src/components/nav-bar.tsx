import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface NavItem {
  label: string;
  href: string;
}

interface NavBarProps extends Omit<React.ComponentProps<'nav'>, 'children'> {
  items: NavItem[];
  brand?: React.ReactNode;
  actions?: React.ReactNode;

  menuResetKey?: string;

  linkComponent?: React.ElementType<{ href: string; className?: string }>;

  sidebarDrawerOpen?: boolean;

  onToggleSidebarDrawer?: () => void;

  sidebarDrawerId?: string;
}

function NavBar({
  items,
  brand,
  actions,
  className,
  linkComponent,
  menuResetKey,
  sidebarDrawerOpen,
  onToggleSidebarDrawer,
  sidebarDrawerId,
  ...props
}: NavBarProps) {
  const LinkComponent = linkComponent ?? 'a';
  return (
    <nav
      data-slot="nav-bar"
      className={cn(
        'flex min-h-14 flex-nowrap items-center gap-x-1 overflow-x-clip border-b border-border bg-background px-2 py-2 sm:h-14 sm:gap-x-4 sm:px-4 sm:py-0',
        className,
      )}
      {...props}
    >
      {onToggleSidebarDrawer ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-slot="nav-bar-sidebar-drawer-trigger"
          aria-label="사이드바 메뉴 열기"
          aria-expanded={sidebarDrawerOpen ?? false}
          aria-controls={sidebarDrawerId}
          onClick={onToggleSidebarDrawer}

          className={cn(
            'shrink-0 text-foreground/80 focus-visible:bg-muted focus-visible:text-foreground',
            'aria-expanded:bg-transparent aria-expanded:text-foreground/80 min-[900px]:hidden',
          )}
        >
          <svg
            aria-hidden
            focusable="false"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-5"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </Button>
      ) : null}
      {brand ? (
        <div
          data-slot="nav-bar-brand"
          className="font-heading whitespace-nowrap text-base font-semibold text-foreground"
        >
          {brand}
        </div>
      ) : null}

      <details
        key={menuResetKey}
        data-slot="nav-bar-menu"
        className="group relative min-w-0 flex-1 min-[900px]:hidden"

        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          const details = event.currentTarget;
          if (!details.open) return;

          event.stopPropagation();
          event.preventDefault();
          details.open = false;

          details
            .querySelector<HTMLElement>('[data-slot="nav-bar-menu-trigger"]')
            ?.focus();
        }}
      >
        <summary
          data-slot="nav-bar-menu-trigger"
          aria-label="메뉴"
          className={cn(
            'flex size-11 cursor-pointer list-none items-center justify-center',
            'rounded-md text-foreground/80 transition-colors',
            'hover:bg-muted hover:text-foreground',
            'focus-visible:bg-muted focus-visible:text-foreground',
            '[&::-webkit-details-marker]:hidden',
          )}
        >
          <svg
            aria-hidden
            focusable="false"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            className="size-5"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </summary>
        <ul
          data-slot="nav-bar-menu-items"
          data-surface="default"
          className="absolute top-full left-0 z-50 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-lg"
        >
          {items.map((item) => (
            <li key={item.href}>
              <LinkComponent
                href={item.href}

                className={cn(
                  'flex min-h-11 w-full items-center px-3 text-sm font-medium text-foreground/80',
                  'transition-colors hover:bg-muted hover:text-foreground',
                  'focus-visible:bg-muted focus-visible:text-foreground',
                )}
              >
                {item.label}
              </LinkComponent>
            </li>
          ))}
        </ul>
      </details>
      <ul
        data-slot="nav-bar-items"
        className="hidden min-w-0 flex-1 items-center gap-0 min-[900px]:flex sm:gap-1"
      >
        {items.map((item) => (
          <li key={item.href}>
            <LinkComponent
              href={item.href}
              className={cn(
                'whitespace-nowrap rounded-md px-1 py-1.5 text-sm font-medium text-foreground/80',
                'transition-colors hover:bg-muted hover:text-foreground',
                'focus-visible:bg-muted focus-visible:text-foreground sm:px-2.5',
              )}
            >
              {item.label}
            </LinkComponent>
          </li>
        ))}
      </ul>
      {actions ? (
        <div
          data-slot="nav-bar-actions"
          className="flex shrink-0 items-center justify-end gap-0 sm:gap-2"
        >
          {actions}
        </div>
      ) : null}
    </nav>
  );
}

export { NavBar };
export type { NavBarProps };
