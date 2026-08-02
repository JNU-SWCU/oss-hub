import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 네이티브 `<select>`의 규격 래퍼.
 *
 * 선택도 버튼·입력과 같은 "조작 가능한 사각형"이라 시안 v2에서 높이가 같아야
 * 한다(`--control-height`). 화면마다 `h-9 rounded-md ...`를 손으로 적으면 그 값이
 * 곧 갈라지므로, Input과 같은 규격을 한곳에 둔다. 동작·접근성은 네이티브 그대로다
 * — 열림 UI를 직접 그리지 않으므로 모바일 기본 피커와 키보드 조작을 잃지 않는다.
 */
function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'h-control w-full min-w-0 rounded-control border border-input bg-transparent px-4 text-body transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80',
        className,
      )}
      {...props}
    />
  );
}

export { Select };
