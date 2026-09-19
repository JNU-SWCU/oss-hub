'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * 필터·세그먼트 칩 묶음.
 *
 * 칩은 눌림을 `aria-pressed`로 말하는 Button(`toggle` 변형)이고, 묶음은 `role="group"`과
 * `aria-label`로 무엇을 거르는지 말한다. 화살표 좌우·Home·End로 칩 사이를 옮긴다 —
 * 제출 단계 이동 한 곳에만 있던 동작을 모든 사용처가 갖는다.
 * 둥근 알약이지만 읽기 전용 StatusBadge(h-tag 26px·앞의 점·테두리 없음)와 달리 44px 높이에
 * 테두리가 있어 누르는 것임이 보인다(R-31).
 */
export interface FilterChipGroupProps extends React.ComponentProps<'div'> {
  readonly 'aria-label': string;
}

const CHIP_SELECTOR = 'button[data-variant="toggle"]:not(:disabled)';

function moveFocus(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
  const chips = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(CHIP_SELECTOR),
  );
  const index = chips.indexOf(event.target as HTMLButtonElement);
  if (index === -1) return;
  const last = chips.length - 1;
  let next = index;
  if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
  if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = last;
  event.preventDefault();
  chips[next]?.focus();
}

function FilterChipGroup({
  className,
  onKeyDown,
  ...props
}: FilterChipGroupProps) {
  return (
    <div
      role="group"
      data-slot="filter-chip-group"
      className={cn('flex flex-wrap gap-2', className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented) moveFocus(event);
      }}
      {...props}
    />
  );
}

export interface FilterChipProps extends Omit<
  React.ComponentProps<typeof Button>,
  'variant' | 'size' | 'aria-pressed'
> {
  /** 지금 걸려 있는 필터인지. `aria-pressed`로 나간다. */
  readonly pressed: boolean;
}

function FilterChip({ pressed, type = 'button', ...props }: FilterChipProps) {
  return (
    <Button
      type={type}
      variant="toggle"
      size="sm"
      aria-pressed={pressed}
      {...props}
    />
  );
}

export { FilterChip, FilterChipGroup };
