'use client';

import { useId, useState, type ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';
import { ListPanel } from '@/components';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  auditLogRecordKey,
  type AuditFeedDay,
  type AuditFeedRun,
} from './audit-log-fold';
import {
  AUDIT_LOG_CATEGORY_LABELS,
  dayLabel,
  formatTime,
  formatTimeRange,
  targetLabel,
} from './audit-log-format';
import {
  AuditLogActionValue,
  AuditLogActor,
  AuditLogChangeValue,
  AuditLogRole,
  AuditLogTargetValue,
} from './audit-log-parts';
import type { AuditLogRecord } from './types';

const ROW_CLASS = cn(
  'flex w-full flex-wrap items-baseline justify-start gap-x-2 gap-y-0.5 px-4 py-3 text-left text-table',
  'hover:bg-muted/50 aria-pressed:bg-muted sm:py-2',
);

const ROW_ITEM_CLASS = 'border-t border-border/50';

interface RowSelection {
  readonly selectedId: string | null;
  readonly onSelect: (key: string | null) => void;
}

function EventRow({
  record,
  nested,
  selectedId,
  onSelect,
}: RowSelection & {
  readonly record: AuditLogRecord;
  readonly nested: boolean;
}): ReactElement {
  const key = auditLogRecordKey(record);
  const selected = key === selectedId;
  return (
    <li className={ROW_ITEM_CLASS}>
      <Button
        type="button"
        variant="bare"
        size="content"
        aria-pressed={selected}
        className={cn(ROW_CLASS, nested && 'pl-10')}
        onClick={() => onSelect(selected ? null : key)}
      >
        <time
          dateTime={record.occurredAt}
          className="shrink-0 text-muted-foreground tabular-nums"
        >
          {formatTime(record.occurredAt)}
        </time>
        <AuditLogActor record={record} />
        <AuditLogRole record={record} />
        <AuditLogActionValue record={record} />
        {targetLabel(record) === null ? null : (
          <span className="inline-flex min-w-0 items-baseline gap-x-2">
            <span aria-hidden="true" className="text-muted-foreground">
              →
            </span>
            <AuditLogTargetValue record={record} />
          </span>
        )}
        <AuditLogChangeValue record={record} />
      </Button>
    </li>
  );
}

function RunRow({
  run,
  open,
  onToggle,
  selectedId,
  onSelect,
}: RowSelection & {
  readonly run: AuditFeedRun;
  readonly open: boolean;
  readonly onToggle: () => void;
}): ReactElement {
  const panelId = useId();
  return (
    <li className={ROW_ITEM_CLASS}>
      <Button
        type="button"
        variant="bare"
        size="content"
        aria-expanded={open}
        aria-controls={panelId}
        className={ROW_CLASS}
        onClick={onToggle}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 self-center text-muted-foreground',
            open && 'rotate-90',
          )}
        />
        <span>
          {AUDIT_LOG_CATEGORY_LABELS.LOGIN} {run.records.length}건 · 실패{' '}
          {run.failures}건
        </span>
        <span className="ml-auto text-muted-foreground tabular-nums">
          {formatTimeRange(run.from, run.to)}
        </span>
      </Button>
      <ul id={panelId} hidden={!open}>
        {open
          ? run.records.map((record) => (
              <EventRow
                key={auditLogRecordKey(record)}
                record={record}
                nested
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))
          : null}
      </ul>
    </li>
  );
}

export function AuditLogFeed({
  days,
  now,
  selectedId,
  onSelect,
}: RowSelection & {
  readonly days: readonly AuditFeedDay[];
  readonly now: Date;
}): ReactElement {
  const [openRuns, setOpenRuns] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpenRuns((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => {
        const label = dayLabel(day.at, now);
        return (
          <section
            key={day.key}
            aria-label={label}
            className="flex flex-col gap-2"
          >
            <h2 className="text-xs font-semibold text-muted-foreground">
              {label}
            </h2>
            <ListPanel>
              <ul className="[&>li:first-child]:border-t-0">
                {day.items.map((item) =>
                  item.kind === 'run' ? (
                    <RunRow
                      key={item.key}
                      run={item}
                      open={openRuns.has(item.key)}
                      onToggle={() => toggle(item.key)}
                      selectedId={selectedId}
                      onSelect={onSelect}
                    />
                  ) : (
                    <EventRow
                      key={item.key}
                      record={item.record}
                      nested={false}
                      selectedId={selectedId}
                      onSelect={onSelect}
                    />
                  ),
                )}
              </ul>
            </ListPanel>
          </section>
        );
      })}
    </div>
  );
}
