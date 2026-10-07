import * as React from 'react';

import { cn } from '@/lib/utils';

function ListPanel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-panel"
      className={cn(
        'overflow-hidden rounded-card ring-1 ring-foreground/10',
        className,
      )}
      {...props}
    />
  );
}

function ListRow({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-row"
      className={cn(
        'flex min-h-row flex-wrap items-center gap-4 px-6 py-4 transition-colors [&+&]:border-t [&+&]:border-border/50',
        className,
      )}
      {...props}
    />
  );
}

export { ListPanel, ListRow };
