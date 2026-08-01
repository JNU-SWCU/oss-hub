import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * 시안 v2 — 조작 가능한 사각형은 전부 같은 높이(`--control-height` = 44px)다.
 * size 변형은 높이를 바꾸지 않는다. 좌우 여백과 글자 크기만 달라진다 —
 * 높이가 갈리는 순간 한 줄에 놓인 버튼·입력·선택의 밑선이 어긋나고,
 * 44px 아래로 내려가면 터치 타깃 최소치도 함께 깨지기 때문이다.
 */
const buttonVariants = cva(
  "group/button inline-flex h-control shrink-0 items-center justify-center rounded-control border border-transparent bg-clip-padding font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/80',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        // 텍스트는 `--destructive`가 아니라 `--destructive-on-tint`를 쓴다. 배경이
        // 같은 토큰의 반투명 tint라 텍스트까지 같은 토큰이면 대비가 상한에 갇힌다
        // (합성 결과 라이트 hover 4.27:1, 다크 카드 hover 3.28:1로 AA 미달이었다).
        destructive:
          'bg-destructive/10 text-destructive-on-tint hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default:
          'gap-2 px-6 text-body has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5',
        xs: "gap-1.5 px-3 text-small in-data-[slot=button-group]:rounded-control has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "gap-2 px-4 text-small in-data-[slot=button-group]:rounded-control has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-4",
        lg: 'gap-2 px-8 text-body has-data-[icon=inline-end]:pr-6 has-data-[icon=inline-start]:pl-6',
        icon: 'w-control px-0',
        'icon-xs':
          "w-control px-0 in-data-[slot=button-group]:rounded-control [&_svg:not([class*='size-'])]:size-4",
        'icon-sm':
          'w-control px-0 in-data-[slot=button-group]:rounded-control',
        'icon-lg': 'w-control px-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
