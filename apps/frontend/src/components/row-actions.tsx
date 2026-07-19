import * as React from 'react';

import { cn } from '@/lib/utils';

interface RowActionsProps extends React.ComponentProps<'div'> {}

// DataTable 행 우측에 배치하는 액션 묶음. 버튼·메뉴 트리거 등은 소비 화면이
// children으로 채우는 슬롯 기반 컴포넌트라 승인/반려/회수 같은 구체 액션을
// 이 컴포넌트가 알지 못한다.
function RowActions({ className, children, ...props }: RowActionsProps) {
  return (
    <div
      data-slot="row-actions"
      className={cn('flex items-center justify-end gap-1.5', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { RowActions };
export type { RowActionsProps };
