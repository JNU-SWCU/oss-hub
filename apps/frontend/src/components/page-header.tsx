import * as React from 'react';

import { cn } from '@/lib/utils';

interface PageHeaderProps extends Omit<
  React.ComponentProps<'header'>,
  'title'
> {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;

  titleAction?: React.ReactNode;

  titleClassName?: string;

  descriptionClassName?: string;

  titleAs?: 'h1' | 'h2';
}

function PageHeader({
  title,
  description,
  actions,
  titleAction,
  className,
  titleClassName,
  descriptionClassName,
  titleAs: TitleTag = 'h1',
  ...props
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"

      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-3">
        {titleAction ? (
          <div className="flex min-w-0 items-center gap-2">
            <TitleTag
              data-slot="page-header-title"
              className={cn(
                'font-heading text-section leading-tight font-bold tracking-tight break-keep text-pretty sm:text-page',
                titleClassName,
              )}
            >
              {title}
            </TitleTag>
            <div data-slot="page-header-title-action" className="shrink-0">
              {titleAction}
            </div>
          </div>
        ) : (
          <TitleTag
            data-slot="page-header-title"

            className={cn(
              'font-heading text-section leading-tight font-bold tracking-tight break-keep text-pretty sm:text-page',
              titleClassName,
            )}
          >
            {title}
          </TitleTag>
        )}
        {description ? (
          <p
            data-slot="page-header-description"
            className={cn(
              'max-w-[60ch] text-body text-muted-foreground break-keep text-pretty',
              descriptionClassName,
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          data-slot="page-header-actions"
          className="flex flex-wrap items-center gap-3"
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export { PageHeader };
