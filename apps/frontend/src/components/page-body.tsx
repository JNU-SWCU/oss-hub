import * as React from 'react';

import { cn } from '@/lib/utils';

function PageBody({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      data-slot="page-body"
      className={cn(
        'mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 pt-8 pb-16 sm:px-12 sm:pt-16 sm:pb-24',
        className,
      )}
      {...props}
    />
  );
}

export { PageBody };
