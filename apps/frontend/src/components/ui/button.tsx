import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * 시안 v2 — 조작 가능한 사각형은 전부 같은 높이(`--control-height` = 44px)다.
 * size 변형은 높이를 바꾸지 않는다. 좌우 여백과 글자 크기만 달라진다 —
 * 높이가 갈리는 순간 한 줄에 놓인 버튼·입력·선택의 밑선이 어긋나고,
 * 44px 아래로 내려가면 터치 타깃 최소치도 함께 깨지기 때문이다.
 *
 * 손 모양 커서를 기본에 둔다. Tailwind v4 preflight 는 `button` 에 `cursor: pointer`
 * 를 넣지 않고 이 저장소도 어디서도 선언하지 않아, **진짜 버튼이 전부 화살표 커서**
 * 였다. 반대로 링크·클릭 가능한 표 줄에는 손 모양이 떠서 신호가 뒤집혀 있었다.
 * `disabled:pointer-events-none` 이 이미 있어 비활성 버튼에는 커서가 걸리지 않는다.
 *
 * 예외는 `size="content"` 하나다 — 버튼처럼 생기지 않은 「누를 수 있는 면」이며
 * 크기를 바깥 격자나 내용이 정한다. 그 자리도 날 `<button>`을 다시 만들지 않고
 * 이 프리미티브를 거치게 하려고 둔 변형이다.
 */
const buttonVariants = cva(
  "group/button inline-flex h-control shrink-0 cursor-pointer items-center justify-center rounded-control border border-transparent bg-clip-padding font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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
          'bg-destructive/10 text-destructive-on-tint hover:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30',
        link: 'text-primary underline-offset-4 hover:underline',
        // 필터·세그먼트 칩(`FilterChip`)의 토글 표면. 둥근 알약이되 눌림(`aria-pressed`)은
        // secondary 채움, 아니면 테두리만 있는 표면이다. 읽기 전용 StatusBadge(h-tag·점)와는
        // 44px 높이와 테두리로 구분되므로 누르는 것임이 보인다.
        toggle:
          'rounded-full border-border bg-background text-foreground hover:bg-muted aria-pressed:border-secondary aria-pressed:bg-secondary aria-pressed:text-secondary-foreground aria-pressed:hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] dark:border-input',
        /*
         * 표면을 칠하지 않는다. 배경·글자색·hover·눌림(`aria-pressed`)·펼침
         * (`aria-expanded`) 표시를 전부 호출부가 소유한다 — 「누를 수 있는 면」
         * (메뉴 줄, 표 칸, 달력 날짜, 행·카드 선택기, 표 머리글 정렬)을 위한 변형이다.
         * 그 자리들은 오류도 제 방식(FieldError·행 테두리)으로 말하므로 base의
         * `aria-invalid` 표시를 끄되, 끄면서 초점 표시까지 사라지지 않도록 오류 상태의
         * 초점 링을 다시 세운다(변형을 겹쳐 명시도를 올린다). `size="content"`와 함께 쓴다.
         */
        bare: 'disabled:opacity-100 aria-invalid:border-transparent aria-invalid:ring-0 aria-invalid:focus-visible:ring-3 aria-invalid:focus-visible:ring-ring/50',
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
        'icon-sm': 'w-control px-0 in-data-[slot=button-group]:rounded-control',
        'icon-lg': 'w-control px-0',
        /*
         * 높이·모서리·테두리·글자 굵기를 내용과 호출부에 돌려준다. 44px 규칙(R-38)이
         * 지켜야 하는 것은 **손가락이 닿는 컨트롤**이고, 표 칸·달력 칸처럼 크기를
         * 바깥 격자가 정하는 자리는 그 대상이 아니다. 여백·정렬·줄바꿈 폭은 호출부가
         * 제 값을 적어 이긴다(`cn`이 전용 토큰까지 알아보므로 실제로 이긴다 — #1334).
         */
        content:
          'block h-auto shrink rounded-none border-0 font-normal whitespace-normal transition-none select-text active:not-aria-[haspopup]:translate-y-0',
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
