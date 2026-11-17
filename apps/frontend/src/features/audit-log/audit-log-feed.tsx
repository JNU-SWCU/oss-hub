import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';
import { dayKey, dayLabel, formatTime } from './audit-log-format';
import {
  AuditLogActionValue,
  AuditLogActor,
  AuditLogChangeValue,
  AuditLogRole,
  AuditLogTargetValue,
} from './audit-log-parts';
import type { AuditLogRecord } from './types';

interface FeedDay {
  readonly key: string;
  readonly records: readonly AuditLogRecord[];
}

function groupByDay(records: readonly AuditLogRecord[]): readonly FeedDay[] {
  const days: { key: string; records: AuditLogRecord[] }[] = [];
  for (const record of records) {
    const key = dayKey(record.occurredAt);
    const last = days.at(-1);
    if (last?.key === key) last.records.push(record);
    else days.push({ key, records: [record] });
  }
  return days;
}

function FeedRow({
  record,
  chained,
}: {
  readonly record: AuditLogRecord;
  readonly chained: boolean;
}): ReactElement {
  return (
    <li
      className={cn(
        'grid grid-cols-[1fr_auto] items-baseline gap-3 border-b border-border/60 py-2.5 text-sm',
        chained && 'ml-4 border-l-2 border-l-border pl-3',
      )}
    >
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 leading-relaxed">
        <AuditLogActor record={record} />
        <AuditLogRole record={record} />
        {record.category === 'LOGIN' ? null : (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              →
            </span>
            <AuditLogTargetValue record={record} />
          </>
        )}
        <AuditLogActionValue record={record} />
        <AuditLogChangeValue record={record} />
      </p>
      <time
        dateTime={record.occurredAt}
        className="text-xs text-muted-foreground tabular-nums"
      >
        {formatTime(record.occurredAt)}
      </time>
    </li>
  );
}

export function AuditLogFeed({
  records,
  now,
}: {
  readonly records: readonly AuditLogRecord[];
  readonly now: Date;
}): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      {groupByDay(records).map((day) => (
        <section
          key={day.key}
          aria-label={dayLabel(day.records[0].occurredAt, now)}
        >
          <h2 className="text-xs font-semibold text-muted-foreground">
            {dayLabel(day.records[0].occurredAt, now)}
          </h2>
          <ul className="flex flex-col">
            {day.records.map((record, index) => (
              <FeedRow
                key={record.id}
                record={record}
                chained={
                  record.requestId !== null &&
                  day.records[index - 1]?.requestId === record.requestId
                }
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
