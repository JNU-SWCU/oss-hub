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

    icon?: ReactNode;
  };

  statusDescription?: string;

  cover?: ReactNode;

  meta?: ReactNode;

  details?: ReadonlyArray<{
    readonly label?: string;
    readonly value: ReactNode;
  }>;
  note?: ReactNode;
  href?: string;
}

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
