'use client';

import { MessageSquareText } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';

import { StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import {
  SUBMISSION_STATUS_BADGE,
  SUBMISSION_STATUS_LABELS,
} from '@/lib/status-vocabulary';
import { cn } from '@/lib/utils';
import { formatDashboardDate, formatDashboardDeadline } from '../deadline';
import type { DashboardFeedbackItem } from '../types';

const VISIBLE_FEEDBACK_ROWS = 3;
const COMMENT_PREVIEW_LENGTH = 80;

function commentPreview(comment: string | null): string | null {
  const characters = Array.from((comment ?? '').replace(/\s+/g, ' ').trim());
  if (characters.length === 0) return null;
  return characters.length > COMMENT_PREVIEW_LENGTH
    ? `${characters.slice(0, COMMENT_PREVIEW_LENGTH).join('')}…`
    : characters.join('');
}

function FeedbackRow({
  item,
  now,
}: {
  readonly item: DashboardFeedbackItem;
  readonly now: Date;
}) {
  const preview = commentPreview(item.comment);
  const resubmissionDueAt =
    item.decision === 'CHANGES_REQUESTED' ? item.resubmissionDueAt : null;

  return (
    <li
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5',
        'sm:grid-cols-[auto_minmax(0,max-content)_minmax(0,1fr)_auto]',
      )}
    >
      <StatusBadge variant={SUBMISSION_STATUS_BADGE[item.decision]}>
        {SUBMISSION_STATUS_LABELS[item.decision]}
      </StatusBadge>
      <Link
        href={item.href}
        className={cn(
          'truncate font-semibold underline underline-offset-4',
          'focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        )}
      >
        {[...new Set([item.milestoneName, item.itemName])].join(' · ')}
      </Link>
      {preview ? (
        <span className="col-span-2 truncate text-muted-foreground sm:col-span-1">
          {preview}
        </span>
      ) : null}
      <span className="col-span-2 text-badge whitespace-nowrap text-muted-foreground sm:col-span-1 sm:col-start-4 sm:text-right">
        <time dateTime={item.reviewedAt}>
          {formatDashboardDate(item.reviewedAt)}
        </time>
        {' 검토'}
        {resubmissionDueAt ? (
          <>
            {' · '}
            <span className="font-semibold text-status-pending-fg">
              재제출 기한 {formatDashboardDeadline(resubmissionDueAt, now)}
            </span>
          </>
        ) : null}
      </span>
    </li>
  );
}

export function ProgramFeedback({
  items,
  now,
  className,
}: {
  readonly items: readonly DashboardFeedbackItem[];
  readonly now: Date;
  readonly className: string;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) return null;
  const visibleItems = expanded ? items : items.slice(0, VISIBLE_FEEDBACK_ROWS);
  const foldedCount = items.length - VISIBLE_FEEDBACK_ROWS;

  return (
    <div className={cn('flex flex-col gap-2 text-small', className)}>
      <p
        id={`${id}-label`}
        className="flex items-center gap-1.5 font-semibold text-muted-foreground"
      >
        <MessageSquareText aria-hidden="true" className="size-4 shrink-0" />새
        피드백 {items.length}건
      </p>
      <ul
        id={`${id}-list`}
        aria-labelledby={`${id}-label`}
        className="flex flex-col gap-2"
      >
        {visibleItems.map((item) => (
          <FeedbackRow key={item.id} item={item} now={now} />
        ))}
      </ul>
      {foldedCount > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? '피드백 접기' : `피드백 ${foldedCount}건 더 보기`}
        </Button>
      ) : null}
    </div>
  );
}
