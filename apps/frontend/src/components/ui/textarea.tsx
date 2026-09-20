import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 여러 줄 입력. `Input`·`Select`와 **같은 조작 규격**을 쓴다 — 테두리·모서리·여백·포커스
 * 링이 한 화면에서 어긋나지 않게 한곳에 둔다(design.md R-08a).
 *
 * 높이만 다르다: 한 줄이 아니라 문단을 받으므로 `--control-height` 대신 최소 높이를 준다.
 * 화면마다 `min-h-*`가 달라야 하면 `className`으로 덮는다.
 *
 * ⚠ 화면에서 `<textarea>`를 직접 쓰고 클래스를 손으로 적지 않는다. 지금 저장소에 그런
 *   자리가 여럿 있고 전부 조금씩 다른 규격을 갖고 있다 — 그래서 이 프리미티브가 있다.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-20 w-full rounded-control border border-input bg-transparent px-4 py-2 text-body transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
