import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 카드 반복 목록의 그리드 뼈대.
 * StyleGallery grid-repetition/card-grid 패턴 — auto-fit + minmax로 컬럼 수가
 * 뷰포트 폭에 맞춰 자동 반응한다. 호출부는 컬럼 수를 지정하는 prop을 받지 않는다.
 */
function CardGrid({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-grid"
      className={cn(
        // `items-stretch` + 타일 최소 높이 — 같은 줄에 놓인 카드는 내용 길이가
        // 달라도 높이가 같다. 시안이 "같은 줄 카드는 높이를 묶는다"고 정한 지점이다.
        'grid items-stretch gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(18rem,100%),1fr))] [&>*]:min-h-tile',
        className,
      )}
      {...props}
    />
  );
}

export { CardGrid };
