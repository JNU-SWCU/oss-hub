import * as React from 'react';

import { cn } from '@/lib/utils';

interface SectionHeadingProps extends Omit<
  React.ComponentProps<'div'>,
  'title'
> {
  title: React.ReactNode;
  /** 제목 옆의 보조 문구(개수 등). 제목과 같은 줄에서 작게 읽힌다. */
  meta?: React.ReactNode;
  /** 오른쪽 끝 슬롯 — 보통 텍스트 링크 하나. 화면의 주 행동은 여기 두지 않는다. */
  action?: React.ReactNode;
}

/**
 * 섹션 머리. 크기 계단의 두 번째 칸(`--step-section` = 24)을 쓰는 유일한 자리다.
 *
 * 화면마다 h2 크기를 직접 고르면 페이지 제목(40)과 본문(16) 사이가 화면마다
 * 달라진다. 계단은 네 칸뿐이고, 섹션 제목은 그중 하나로 고정한다.
 */
function SectionHeading({
  title,
  meta,
  action,
  className,
  id,
  ...props
}: SectionHeadingProps) {
  return (
    <div
      data-slot="section-heading"
      className={cn('flex flex-wrap items-center gap-4', className)}
      {...props}
    >
      <h2
        id={id}
        className="font-heading text-section leading-tight font-semibold tracking-tight"
      >
        {title}
      </h2>
      {meta ? (
        <span className="text-small text-muted-foreground">{meta}</span>
      ) : null}
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

export { SectionHeading };
export type { SectionHeadingProps };
