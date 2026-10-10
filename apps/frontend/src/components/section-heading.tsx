import * as React from 'react';

import { cn } from '@/lib/utils';

interface SectionHeadingProps extends Omit<
  React.ComponentProps<'div'>,
  'title'
> {
  title: React.ReactNode;

  meta?: React.ReactNode;

  action?: React.ReactNode;
}

function SectionHeading({
  title,
  meta,
  action,
  className,
  id,
  ...props
}: SectionHeadingProps) {
  return (
    <div
      data-slot="section-heading"
      className={cn('flex flex-wrap items-center gap-4', className)}
      {...props}
    >
      <h2
        id={id}
        className="font-heading text-section leading-tight font-semibold tracking-tight"
      >
        {title}
      </h2>
      {meta ? (
        <span className="text-small text-muted-foreground">{meta}</span>
      ) : null}
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

export { SectionHeading };
