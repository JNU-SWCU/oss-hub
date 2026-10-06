import * as React from 'react';

import { cn } from '@/lib/utils';

interface RowActionsProps extends React.ComponentProps<'div'> {}

function RowActions({ className, children, ...props }: RowActionsProps) {
  return (
    <div
      data-slot="row-actions"
      className={cn('flex items-center justify-end gap-1.5', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { RowActions };
export type { RowActionsProps };
