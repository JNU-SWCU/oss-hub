import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const statusBadgeVariants = cva(
  "inline-flex h-tag w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 text-badge font-semibold before:size-1.5 before:shrink-0 before:rounded-full before:bg-current before:content-['']",
  {
    variants: {
      size: {
        default: 'py-0.5 text-badge',

        lg: 'h-auto min-w-24 justify-center px-4 py-2 text-base font-semibold',
      },
      variant: {
        recruiting: 'bg-status-recruiting-bg text-status-recruiting-fg',
        closed: 'bg-status-closed-bg text-status-closed-fg',
        pending: 'bg-status-pending-bg text-status-pending-fg',
        approved: 'bg-status-approved-bg text-status-approved-fg',
        rejected: 'bg-status-rejected-bg text-status-rejected-fg',
      },
    },
    defaultVariants: {
      size: 'default',
      variant: 'recruiting',
    },
  },
);

function StatusBadge({
  className,
  size = 'default',
  variant = 'recruiting',
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof statusBadgeVariants>) {
  return (
    <span
      data-slot="status-badge"
      data-size={size}
      data-variant={variant}
      className={cn(statusBadgeVariants({ size, variant }), className)}
      {...props}
    />
  );
}

export { StatusBadge, statusBadgeVariants };
