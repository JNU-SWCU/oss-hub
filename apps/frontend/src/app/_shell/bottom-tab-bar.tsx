'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { isCurrentSection, type SectionItem } from './section-list';
import { ShellIcon } from './shell-icons';

export function BottomTabBar({
  items,
  pathname,
}: {
  readonly items: readonly SectionItem[];
  readonly pathname: string;
}) {
  return (
    <nav
      aria-label="섹션"
      data-slot="bottom-tab-bar"
      data-breakpoint-visibility="mobile"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex h-bottom-tabs-clearance flex-col',
        'border-t border-border bg-background pb-safe-bottom shell:hidden',
      )}
    >
      <ul className="mx-auto flex min-h-0 w-full max-w-md flex-1 items-stretch">
        {items.map((item) => {
          const current = isCurrentSection(pathname, item.id);
          return (
            <li key={item.id} className="flex min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                data-current={current ? 'true' : undefined}
                className={cn(
                  'flex min-h-control w-full flex-col items-center justify-center gap-1 px-1 text-badge font-medium text-muted-foreground transition-colors',
                  'hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none',
                  current && 'font-semibold text-sidebar-current-foreground',
                )}
              >
                <ShellIcon name={item.icon} />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
