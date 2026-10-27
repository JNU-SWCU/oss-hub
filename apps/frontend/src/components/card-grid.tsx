import * as React from 'react';

import { cn } from '@/lib/utils';

function CardGrid({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-grid"
      className={cn(
        'grid min-w-0 w-full items-stretch gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(17rem,100%),1fr))] [&>*]:min-w-0 [&>*]:min-h-tile',
        className,
      )}
      {...props}
    />
  );
}

export { CardGrid };
