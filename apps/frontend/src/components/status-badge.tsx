import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * 프로그램·신청 상태 뱃지. 상태→색 매핑은 globals.css의 semantic
 * `--status-*` 토큰에 고정돼 있고(하드코딩 색상 금지), 실제 상태 문자열은
 * children으로 호출부가 주입한다.
 */
const statusBadgeVariants = cva(
  // 시안 v2 — 배지는 유일한 예외 높이(`--tag-height` = 26)다. 누르는 것이 아니라
  // 읽는 라벨이라 44에 맞추지 않는다.
  // 앞의 점은 장식이 아니다. 상태를 색으로만 구분하면 색각 이상 사용자가 읽을 수
  // 없으므로 색 + 글자 + 점 세 신호를 함께 쓴다(글자는 호출부가 children으로 준다).
  "inline-flex h-tag w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 text-badge font-semibold before:size-1.5 before:shrink-0 before:rounded-full before:bg-current before:content-['']",
  {
    variants: {
      size: {
        default: 'py-0.5 text-badge',
        // 기본 높이 `h-tag`(26px)를 풀어 준다 — lg 는 16px 글자(줄 높이
        // 24px)에 위아래 8px 여백을 주므로 내용이 40px 이다. 높이를 26px 로
        // 묶어 두면 적어 둔 여백이 한 픽셀도 쓰이지 않고 글자만 알약에
        // 끼인다(#1400).
        lg: 'h-auto min-w-24 justify-center px-4 py-2 text-base font-semibold',
      },
      variant: {
        recruiting: 'bg-status-recruiting-bg text-status-recruiting-fg',
        closed: 'bg-status-closed-bg text-status-closed-fg',
        pending: 'bg-status-pending-bg text-status-pending-fg',
        approved: 'bg-status-approved-bg text-status-approved-fg',
        rejected: 'bg-status-rejected-bg text-status-rejected-fg',
      },
    },
    defaultVariants: {
      size: 'default',
      variant: 'recruiting',
    },
  },
);

function StatusBadge({
  className,
  size = 'default',
  variant = 'recruiting',
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof statusBadgeVariants>) {
  return (
    <span
      data-slot="status-badge"
      data-size={size}
      data-variant={variant}
      className={cn(statusBadgeVariants({ size, variant }), className)}
      {...props}
    />
  );
}

export { StatusBadge, statusBadgeVariants };
