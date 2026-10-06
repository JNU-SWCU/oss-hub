import * as React from 'react';

import { cn } from '@/lib/utils';

function CardGrid({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-grid"
      className={cn(
        'grid min-w-0 w-full items-stretch gap-4 [container-type:inline-size] [grid-template-columns:repeat(auto-fill,minmax(min(18rem,100%),max-content))] [&>*]:min-h-tile [&>*]:w-[22rem] [&>*]:max-w-full',
        className,
      )}
      {...props}
    />
  );
}

export { CardGrid };
