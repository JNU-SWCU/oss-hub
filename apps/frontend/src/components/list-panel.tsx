import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 시안 v2의 "목록" — 항목마다 카드를 하나씩 두지 않고, 카드 **하나** 안에 줄을
 * 쌓고 줄 사이만 아주 옅게 구분한다.
 *
 * 카드를 반복하면 테두리가 항목 수만큼 생겨 목록 자체의 윤곽이 사라진다. 마일스톤
 * 처럼 "같은 성격의 항목이 순서대로 이어지는" 자리는 표와 카드 사이의 이 형태가
 * 맞다. 카드 격자(CardGrid)는 서로 독립적인 대상을 늘어놓을 때 쓴다.
 */
function ListPanel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-panel"
      className={cn(
        'overflow-hidden rounded-card ring-1 ring-foreground/10',
        className,
      )}
      {...props}
    />
  );
}

/**
 * 목록 한 줄. 최소 높이 `--row-height`(76)로 줄마다 손이 닿는 크기를 보장하고,
 * 첫 줄을 제외한 모든 줄 위에 옅은 선을 긋는다.
 */
function ListRow({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-row"
      className={cn(
        'flex min-h-row flex-wrap items-center gap-4 px-6 py-4 transition-colors hover:bg-muted/60 [&+&]:border-t [&+&]:border-border/50',
        className,
      )}
      {...props}
    />
  );
}

export { ListPanel, ListRow };
