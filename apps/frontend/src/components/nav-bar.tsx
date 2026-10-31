import * as React from 'react';

import { cn } from '@/lib/utils';

export interface NavItem {
  label: string;
  href: string;
}

interface NavBarProps extends Omit<React.ComponentProps<'nav'>, 'children'> {
  items: readonly NavItem[];
  brand?: React.ReactNode;
  actions?: React.ReactNode;

  leading?: React.ReactNode;

  currentPath?: string;

  menuResetKey?: string;

  compactMenu?: boolean;

  linkComponent?: React.ElementType<{ href: string; className?: string }>;
}

function isCurrentNavItem(
  currentPath: string | undefined,
  href: string,
): boolean {
  if (currentPath === undefined) return false;
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

function NavBar({
  items,
  brand,
  actions,
  leading,
  currentPath,
  className,
  linkComponent,
  menuResetKey,
  compactMenu = true,
  ...props
}: NavBarProps) {
  const LinkComponent = linkComponent ?? 'a';
  return (
    <nav
      data-slot="nav-bar"
      className={cn(
        'relative flex min-h-14 flex-nowrap items-center gap-x-1 overflow-x-clip border-b border-border bg-background px-2 py-2 sm:h-14 sm:gap-x-4 sm:px-4 sm:py-0',
        className,
      )}
      {...props}
    >
      {leading}
      {brand ? (
        <div
          data-slot="nav-bar-brand"
          className="font-heading whitespace-nowrap text-base font-semibold text-foreground"
        >
          {brand}
        </div>
      ) : null}

      {compactMenu ? (
        <details
          key={menuResetKey}
          data-slot="nav-bar-menu"
          data-breakpoint-visibility="narrow"
          className="group relative min-w-0 flex-1 max-[480px]:static min-[640px]:hidden"
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
            className={cn(
              'absolute top-full left-0 z-50 mt-1 w-52 overflow-hidden py-1 max-[480px]:left-2',
              'rounded-lg border border-border bg-background shadow-lg',
            )}
          >
            {items.map((item) => {
              const current = isCurrentNavItem(currentPath, item.href);
              return (
                <li key={item.href} className="relative">
                  <LinkComponent
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    data-current={current ? 'true' : undefined}
                    className={cn(
                      'flex min-h-11 w-full items-center px-3 text-sm font-medium text-foreground/80',
                      'transition-colors hover:bg-muted hover:text-foreground',
                      'focus-visible:bg-muted focus-visible:text-foreground',
                      current &&
                        'bg-sidebar-current font-semibold text-sidebar-current-foreground',
                    )}
                  >
                    {item.label}
                  </LinkComponent>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
      <ul
        data-slot="nav-bar-items"
        data-breakpoint-visibility={compactMenu ? 'wide' : 'desktop'}
        className={cn(
          'hidden min-w-0 flex-1 items-center gap-0 self-stretch sm:gap-1',
          compactMenu ? 'min-[640px]:flex' : 'shell:flex',
        )}
      >
        {items.map((item) => {
          const current = isCurrentNavItem(currentPath, item.href);
          return (
            <li key={item.href} className="relative flex h-full items-center">
              <LinkComponent
                href={item.href}
                aria-current={current ? 'page' : undefined}
                data-current={current ? 'true' : undefined}
                className={cn(
                  'whitespace-nowrap rounded-md px-1 py-1.5 text-sm font-medium text-foreground/80',
                  'transition-colors hover:bg-muted hover:text-foreground',
                  'focus-visible:bg-muted focus-visible:text-foreground sm:px-2.5',
                  current && 'font-semibold text-sidebar-current-foreground',
                )}
              >
                {item.label}
              </LinkComponent>
              {current ? (
                <span
                  aria-hidden
                  data-slot="nav-bar-current-marker"
                  className="absolute inset-x-1 bottom-0 h-sidebar-marker rounded-t-full bg-sidebar-current-marker sm:inset-x-2.5"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {actions ? (
        <div
          data-slot="nav-bar-actions"
          className="ml-auto flex shrink-0 items-center justify-end gap-0 sm:gap-2"
        >
          {actions}
        </div>
      ) : null}
    </nav>
  );
}

export { NavBar };
