import * as React from 'react';

import { cn } from '@/lib/utils';

interface PageHeaderProps extends Omit<
  React.ComponentProps<'header'>,
  'title'
> {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

/**
 * 페이지 제목 + 설명 + 우측 액션 슬롯. 화면 상단에서 반복되는 뼈대를 공용화한다.
 */
function PageHeader({
  title,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        'flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-1">
        <h1
          data-slot="page-header-title"
          className="font-heading text-3xl font-bold tracking-tight"
        >
          {title}
        </h1>
        {description ? (
          <p
            data-slot="page-header-description"
            className="text-sm text-muted-foreground"
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          data-slot="page-header-actions"
          className="flex items-center gap-2"
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export { PageHeader };
export type { PageHeaderProps };
