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
  /**
   * `true`면 뷰포트 폭과 무관하게 항상 1열(보조 패널이 본문 아래로)로
   * 렌더링해 `md:` 2열 분할을 끈다. 기본값 `false`는 기존 동작과 완전히
   * 동일하다 — Inspector 오버레이처럼 뷰포트는 넓어도 실제 렌더 폭이 좁게
   * 고정된 컨테이너 안에서만 켠다(뷰포트 미디어 쿼리로는 그 상황을 감지할
   * 수 없어서 크래시 없이 crush되는 문제를 막기 위함).
   */
  stacked?: boolean;
}

// 목록/상세 또는 본문/보조 패널을 2분할하는 레이아웃 뼈대(split-sidebar 계열).
// 시각(색·타이포)은 부여하지 않고 공간 구조만 제공하며, 좁은 화면에서는
// 세로로 쌓이고 넓은 화면에서 두 열로 나뉜다. `stacked`가 켜지면 뷰포트와
// 무관하게 항상 세로로 쌓인다.
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
export type { DetailPanelLayoutProps };
