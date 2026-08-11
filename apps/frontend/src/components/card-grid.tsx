import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 카드 반복 목록의 그리드 뼈대.
 * grid-repetition/card-grid 패턴 — auto-fill은 18rem 바닥으로 열 수를 정하고,
 * 각 자식의 22rem 너비가 max-content 트랙의 상한을 정한다. inline-size
 * containment는 좁은 부모에서 그 상한이 그리드 자체를 밀어내지 않게 한다.
 */
function CardGrid({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-grid"
      className={cn(
        // `items-stretch` + 타일 최소 높이 — 같은 줄에 놓인 카드는 내용 길이가
        // 달라도 높이가 같다. 시안이 "같은 줄 카드는 높이를 묶는다"고 정한 지점이다.
        'grid min-w-0 w-full items-stretch gap-4 [container-type:inline-size] [grid-template-columns:repeat(auto-fill,minmax(min(18rem,100%),max-content))] [&>*]:min-h-tile [&>*]:w-[22rem] [&>*]:max-w-full',
        className,
      )}
      {...props}
    />
  );
}

export { CardGrid };
