'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type FilterChipGroupProps = React.ComponentProps<'div'> &
  ({ readonly 'aria-label': string } | { readonly 'aria-labelledby': string });

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

interface FilterChipProps extends Omit<
  React.ComponentProps<typeof Button>,
  'variant' | 'size' | 'aria-pressed'
> {
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
