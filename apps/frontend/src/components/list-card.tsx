import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

import { StatusBadge } from '@/components/status-badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
  };
  /** 제목 앞에서 읽을 상태 설명. 없으면 배지 문구를 그대로 읽는다. */
  statusDescription?: string;
  /** cover·meta·note에는 링크나 버튼을 넣지 않는다: 카드가 유일한 탐색 지점이다. */
  cover?: ReactNode;
  meta?: ReactNode;
  note?: ReactNode;
  href?: string;
}

/**
 * 목록 항목의 공용 조합. 값이 없는 줄은 렌더하지 않는다.
 * @example
 * <ListCard title="합성 프로젝트" subtitle="2026 오픈소스 프로그램"
 *   badge={{ text: 'GitHub PUBLIC', variant: 'approved' }}
 *   meta={<time dateTime="2026-09-01">2026.09.01</time>}
 *   href="/archive/synthetic-project" />
 */
export function ListCard({
  title,
  subtitle,
  badge,
  statusDescription,
  cover,
  meta,
  note,
  href,
  className,
  ...props
}: ListCardProps) {
  const card = (
    <Card
      data-slot="list-card"
      className={cn(
        'h-full min-w-0 break-keep [overflow-wrap:anywhere]',
        cover && 'pt-0',
        href
          ? 'cursor-pointer transition-shadow hover:ring-ring motion-reduce:transition-none'
          : 'cursor-default',
        className,
      )}
      {...props}
    >
      {cover}
      <CardHeader className="min-w-0 gap-2">
        {badge ? (
          <StatusBadge
            className="max-w-full justify-self-start whitespace-normal"
            variant={badge.variant}
            aria-hidden={statusDescription ? true : undefined}
          >
            {badge.text}
          </StatusBadge>
        ) : null}
        <CardTitle>
          {statusDescription ? (
            <span className="sr-only">{statusDescription}</span>
          ) : null}
          {title}
        </CardTitle>
        {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
      </CardHeader>
      {meta || note ? (
        <CardContent className="grid min-w-0 gap-2 text-small">
          {meta ? (
            <div className="text-muted-foreground tabular-nums">{meta}</div>
          ) : null}
          {note ? (
            <div className="font-semibold text-accent">{note}</div>
          ) : null}
        </CardContent>
      ) : null}
      {href ? (
        <CardFooter className="justify-end">
          <span className="text-small font-semibold text-primary">
            자세히 ›
          </span>
        </CardFooter>
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
