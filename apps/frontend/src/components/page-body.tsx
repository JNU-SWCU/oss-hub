import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 업무 화면 본문의 바깥 틀.
 *
 * 시안 v2가 정한 본문 여백(위 64 · 좌우 48 · 아래 96, 좁은 화면에서는 32/24/64)과
 * 최대 폭을 한곳에 둔다. 화면마다 `p-5 sm:p-8`처럼 직접 적으면 화면을 옮겨 다닐 때
 * 본문 시작 위치가 미세하게 흔들린다 — 사용자는 그 흔들림을 "정리되지 않았다"로
 * 읽는다.
 *
 * 자식 사이 간격은 48(페이지 머리 → 첫 섹션). 섹션이 여럿이면 그 묶음을
 * `gap-16`(64) 컨테이너로 감싼다.
 */
function PageBody({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      data-slot="page-body"
      className={cn(
        'mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 pt-8 pb-16 sm:px-12 sm:pt-16 sm:pb-24',
        className,
      )}
      {...props}
    />
  );
}

export { PageBody };
