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
      // 시안 v2 — 페이지 머리에는 선을 긋지 않는다. 제목 크기(40)와 아래 여백만으로
      // 이미 구분되고, 선을 더하면 섹션 구분선과 위계가 섞인다.
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <h1
          data-slot="page-header-title"
          // 크기 계단의 맨 위 칸. 좁은 화면에서 40px은 제목 한 줄이 화면을 넘기므로
          // 한 계단 내려 섹션 크기로 쓴다(시안의 900px 미만 규칙과 같은 취지).
          className="font-heading text-section leading-tight font-bold tracking-tight sm:text-page"
        >
          {title}
        </h1>
        {description ? (
          <p
            data-slot="page-header-description"
            className="max-w-[60ch] text-body text-muted-foreground"
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
export type { PageHeaderProps };
