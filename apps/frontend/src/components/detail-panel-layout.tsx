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
}

// 목록/상세 또는 본문/보조 패널을 2분할하는 레이아웃 뼈대(split-sidebar 계열).
// 시각(색·타이포)은 부여하지 않고 공간 구조만 제공하며, 좁은 화면에서는
// 세로로 쌓이고 넓은 화면에서 두 열로 나뉜다.
function DetailPanelLayout({
  primary,
  secondary,
  primaryClassName,
  secondaryClassName,
  className,
  ...props
}: DetailPanelLayoutProps) {
  return (
    <div
      data-slot="detail-panel-layout"
      className={cn(
        'grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]',
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
export type { DetailPanelLayoutProps };
