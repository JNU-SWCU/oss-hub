import * as React from 'react';

import { cn } from '@/lib/utils';

interface EmptyStateProps extends React.ComponentProps<'div'> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

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
        'grid justify-items-center gap-3 rounded-card border border-dashed border-border p-12 text-center',
        className,
      )}
      {...props}
    >
      {icon ? (
        <div
          data-slot="empty-state-icon"
          aria-hidden="true"
          className="text-muted-foreground"
        >
          {icon}
        </div>
      ) : null}
      <p className="font-heading text-body font-semibold text-foreground">
        {title}
      </p>
      {description ? (
        <p className="max-w-[46ch] text-body text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
