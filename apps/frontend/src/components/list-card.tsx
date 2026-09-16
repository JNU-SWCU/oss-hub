import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

import { StatusBadge } from '@/components/status-badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface ListCardProps extends Omit<
  ComponentProps<'div'>,
  'title' | 'children'
> {
  title: string;
  subtitle?: string;
  badge?: {
    text: string;
    variant: ComponentProps<typeof StatusBadge>['variant'];
    /**
     * 있으면 배지 앞의 점을 대체한다. 점은 색각 이상 사용자용 비색 신호라
     * 그냥 지우지 않고, 더 강한 비색 신호인 아이콘이 있을 때만 바뀜다.
     */
    icon?: ReactNode;
  };
  /** 제목 앞에서 읽을 상태 설명. 없으면 배지 문구를 그대로 읽는다. */
  statusDescription?: string;
  /** cover·meta·details·note에는 링크나 버튼을 넣지 않는다: 카드가 유일한 탐색 지점이다. */
  cover?: ReactNode;
  /** 라벨 없는 보조 한 줄(기간 등). */
  meta?: ReactNode;
  /**
   * 라벨·값 쌍. 두 줄의 색은 카드가 정한다 — 라벨은 muted, 값은 foreground.
   * 호출부가 색을 다시 고르면 카드를 합친 이유가 없어진다.
   */
  details?: ReadonlyArray<{
    readonly label?: string;
    readonly value: ReactNode;
  }>;
  note?: ReactNode;
  href?: string;
}

/**
 * 목록 항목의 공용 조합. 값이 없는 줄은 렌더하지 않는다.
 *
 * `href`가 있으면 발치에 「자세히 ›」 한 줄을 둬서 눌러야 하는 카드임을 알린다.
 * 이 줄은 `CardFooter`를 쓰지 않는다 — 그 primitive는 `border-t bg-muted/50`
 * 액션 바 표면이라 클릭 불가 텍스트에 얹으면 회색 띠만 남는다.
 */
export function ListCard({
  title,
  subtitle,
  badge,
  statusDescription,
  cover,
  meta,
  details,
  note,
  href,
  className,
  ...props
}: ListCardProps) {
  const card = (
    <Card
      data-slot="list-card"
      className={cn(
        'h-full min-h-[170px] min-w-0 break-keep [overflow-wrap:anywhere]',
        cover && 'pt-0',
        href
          ? 'cursor-pointer transition-[box-shadow] duration-150 hover:ring-ring hover:shadow-[0_2px_8px_rgba(0,26,77,0.08)] motion-reduce:transition-none'
          : 'cursor-default',
        className,
      )}
      {...props}
    >
      {cover}
      <CardHeader className="min-w-0 gap-1.5">
        {badge ? (
          <CardAction>
            <StatusBadge
              className={cn('font-bold', badge.icon && 'before:hidden')}
              variant={badge.variant}
              aria-hidden={statusDescription ? true : undefined}
            >
              {badge.icon}
              {badge.text}
            </StatusBadge>
          </CardAction>
        ) : null}
        {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
        <CardTitle>
          {statusDescription ? (
            <span className="sr-only">{statusDescription}</span>
          ) : null}
          {title}
        </CardTitle>
      </CardHeader>
      {meta || note || details?.length ? (
        <CardContent className="grid min-w-0 gap-2 text-small">
          {meta ? (
            <div className="text-muted-foreground tabular-nums">{meta}</div>
          ) : null}
          {details?.length ? (
            <div className="grid gap-4">
              {details.map(({ label, value }, index) => (
                <div className="grid gap-1" key={label ?? index}>
                  {label ? (
                    <span className="text-muted-foreground">{label}</span>
                  ) : null}
                  <div className="text-foreground tabular-nums">{value}</div>
                </div>
              ))}
            </div>
          ) : null}
          {note ? (
            <div className="font-semibold text-accent">{note}</div>
          ) : null}
        </CardContent>
      ) : null}
      {href ? (
        <div
          data-slot="list-card-affordance"
          aria-hidden="true"
          className="mt-auto flex justify-end px-(--card-spacing) text-small font-semibold text-primary"
        >
          자세히 ›
        </div>
      ) : null}
    </Card>
  );

  return href ? (
    <Link
      href={href}
      className="block h-full min-w-0 rounded-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {card}
    </Link>
  ) : (
    card
  );
}
