import * as React from 'react';

import { cn } from '@/lib/utils';

interface DetailPanelLayoutProps extends Omit<
  React.ComponentProps<'div'>,
  'children'
> {
  primary: React.ReactNode;
  secondary: React.ReactNode;
  primaryClassName?: string;
  secondaryClassName?: string;

  stacked?: boolean;
}

function DetailPanelLayout({
  primary,
  secondary,
  primaryClassName,
  secondaryClassName,
  stacked = false,
  className,
  ...props
}: DetailPanelLayoutProps) {
  return (
    <div
      data-slot="detail-panel-layout"
      className={cn(
        'grid gap-6',
        !stacked && 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]',
        className,
      )}
      {...props}
    >
      <div
        data-slot="detail-panel-primary"
        className={cn('min-w-0', primaryClassName)}
      >
        {primary}
      </div>
      <div
        data-slot="detail-panel-secondary"
        className={cn('min-w-0', secondaryClassName)}
      >
        {secondary}
      </div>
    </div>
  );
}

export { DetailPanelLayout };
