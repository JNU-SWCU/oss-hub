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

export const listCardClasses = {
  header: 'min-w-0 gap-1.5',
  title: 'line-clamp-2',
  content: 'grid min-w-0 gap-2 text-small',
  meta: 'text-muted-foreground tabular-nums',
  note: 'font-semibold text-accent',
  affordance:
    'mt-auto flex justify-end px-(--card-spacing) text-small font-semibold text-primary',
} as const;

export const listCardCoverClasses = {
  root: 'pt-0 [--card-spacing:--spacing(3)]',
  title: 'min-h-[2lh]',
  content: 'flex-1',
  note: 'min-h-[1lh]',
} as const;

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
        cover && listCardCoverClasses.root,
        href
          ? 'cursor-pointer transition-[box-shadow] duration-150 hover:ring-ring hover:shadow-[0_2px_8px_rgba(0,26,77,0.08)] motion-reduce:transition-none'
          : 'cursor-default',
        className,
      )}
      {...props}
    >
      {cover}
      <CardHeader className={listCardClasses.header}>
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
        <CardTitle
          className={cn(
            listCardClasses.title,
            cover && listCardCoverClasses.title,
          )}
        >
          {statusDescription ? (
            <span className="sr-only">{statusDescription}</span>
          ) : null}
          {title}
        </CardTitle>
      </CardHeader>
      {cover || meta || note || details?.length ? (
        <CardContent
          className={cn(
            listCardClasses.content,
            cover && listCardCoverClasses.content,
          )}
        >
          {meta ? <div className={listCardClasses.meta}>{meta}</div> : null}
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
          {cover || note ? (
            <div
              className={cn(
                listCardClasses.note,
                cover && listCardCoverClasses.note,
              )}
            >
              {note}
            </div>
          ) : null}
        </CardContent>
      ) : null}
      {href ? (
        <div
          data-slot="list-card-affordance"
          aria-hidden="true"
          className={listCardClasses.affordance}
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
