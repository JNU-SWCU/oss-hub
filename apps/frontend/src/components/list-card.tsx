import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

import { StatusBadge } from '@/components/status-badge';
import { SkeletonBlock } from '@/components/ui/skeleton';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

const listCardClasses = {
  root: 'h-full min-w-0 break-keep [overflow-wrap:anywhere] [--card-spacing:--spacing(3)]',
  header: 'min-w-0 gap-1.5',
  title: 'line-clamp-2',
  content: 'grid min-w-0 gap-2 text-small',
  meta: 'text-muted-foreground tabular-nums',
  note: 'font-semibold text-accent',
  affordance:
    'mt-auto flex justify-end px-(--card-spacing) text-small font-semibold text-primary',
} as const;

const listCardMediaClasses = {
  root: 'grid min-h-[170px] grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_1fr_auto] gap-x-3 gap-y-1 p-(--card-spacing)',
  media: 'col-start-1 row-span-full self-start',
  header: 'col-start-2 px-0',
  title: 'min-h-[2lh]',
  content: 'col-start-2 px-0',
  note: 'min-h-[1lh]',
  affordance: 'col-start-2 px-0',
} as const;

interface ListCardFields extends Omit<
  ComponentProps<'div'>,
  'title' | 'children'
> {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly badge?: {
    readonly text: string;
    readonly variant: ComponentProps<typeof StatusBadge>['variant'];
    readonly icon?: ReactNode;
  };
  readonly statusDescription?: string;
  readonly media?: ReactNode;
  readonly meta?: ReactNode;
  readonly details?: ReadonlyArray<{
    readonly label?: string;
    readonly value: ReactNode;
  }>;
  readonly note?: ReactNode;
}

export interface ListCardProps extends ListCardFields {
  readonly title: string;
  readonly subtitle?: string;
  readonly href?: string;
}

function ListCardFrame({
  title,
  subtitle,
  badge,
  statusDescription,
  media,
  meta,
  details,
  note,
  affordance,
  interactive = false,
  className,
  ...props
}: ListCardFields & {
  readonly affordance?: ReactNode;
  readonly interactive?: boolean;
}) {
  return (
    <Card
      data-slot="list-card"
      className={cn(
        listCardClasses.root,
        media && listCardMediaClasses.root,
        interactive
          ? 'cursor-pointer transition-[box-shadow] duration-150 hover:ring-ring hover:shadow-[0_2px_8px_rgba(0,26,77,0.08)] motion-reduce:transition-none'
          : 'cursor-default',
        className,
      )}
      {...props}
    >
      {media ? (
        <div data-slot="list-card-media" className={listCardMediaClasses.media}>
          {media}
        </div>
      ) : null}
      <CardHeader
        className={cn(
          listCardClasses.header,
          media && listCardMediaClasses.header,
        )}
      >
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
            media && listCardMediaClasses.title,
          )}
        >
          {statusDescription ? (
            <span className="sr-only">{statusDescription}</span>
          ) : null}
          {title}
        </CardTitle>
      </CardHeader>
      {media || meta || note || details?.length ? (
        <CardContent
          className={cn(
            listCardClasses.content,
            media && listCardMediaClasses.content,
          )}
        >
          {details?.length ? (
            <div className="grid gap-2">
              {details.map(({ label, value }, index) => (
                <div key={label ?? index}>
                  {label ? (
                    <>
                      <span className="text-muted-foreground">{label}</span>{' '}
                      <span className="text-foreground tabular-nums">
                        {value}
                      </span>
                    </>
                  ) : (
                    <div className="text-foreground tabular-nums">{value}</div>
                  )}
                </div>
              ))}
            </div>
          ) : null}
          {meta ? <div className={listCardClasses.meta}>{meta}</div> : null}
          {media || note ? (
            <div
              className={cn(
                listCardClasses.note,
                media && listCardMediaClasses.note,
              )}
            >
              {note}
            </div>
          ) : null}
        </CardContent>
      ) : null}
      {affordance ? (
        <div
          data-slot="list-card-affordance"
          aria-hidden="true"
          className={cn(
            listCardClasses.affordance,
            media && listCardMediaClasses.affordance,
          )}
        >
          {affordance}
        </div>
      ) : null}
    </Card>
  );
}

export function ListCard({ href, ...props }: ListCardProps) {
  const card = (
    <ListCardFrame
      {...props}
      interactive={Boolean(href)}
      affordance={href ? '자세히 ›' : undefined}
    />
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

function SkeletonLine({ className }: { readonly className: string }) {
  return (
    <div className="flex h-[1lh] items-center">
      <SkeletonBlock className={cn('h-[1em] rounded', className)} />
    </div>
  );
}

export function ListCardSkeleton({ media }: Pick<ListCardProps, 'media'>) {
  return (
    <div className="h-full min-w-0">
      <ListCardFrame
        media={media}
        subtitle={<SkeletonLine className="w-2/5" />}
        title={
          <>
            <SkeletonLine className="w-full" />
            <SkeletonLine className="w-3/4" />
          </>
        }
        meta={<SkeletonLine className="w-3/5" />}
        note={<SkeletonLine className="w-1/3" />}
        affordance={<SkeletonLine className="w-12" />}
      />
    </div>
  );
}
