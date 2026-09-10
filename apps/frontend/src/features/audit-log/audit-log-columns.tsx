import { StatusBadge, type DataTableColumn } from '@/components';
import { resolveAuditLogActionBadge } from './audit-log-action';
import { AuditLogSentence } from './audit-log-sentence';
import {
  describeAuditLog,
  describeTargetType,
  isFallbackTarget,
  TARGETLESS_FALLBACK_TARGET_TYPES,
} from './describe';
import type { AuditLogRecord } from './types';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

const RELATIVE_TIME_UNITS: readonly (readonly [
  Intl.RelativeTimeFormatUnit,
  number,
])[] = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
];

const relativeTimeFormatter = new Intl.RelativeTimeFormat('ko', {
  numeric: 'auto',
});

function formatRelativeTime(value: string, now: Date): string {
  const diffSeconds = Math.round(
    (new Date(value).getTime() - now.getTime()) / 1000,
  );
  if (Math.abs(diffSeconds) < 60) return '방금 전';
  for (const [unit, secondsInUnit] of RELATIVE_TIME_UNITS) {
    if (Math.abs(diffSeconds) >= secondsInUnit) {
      return relativeTimeFormatter.format(
        Math.trunc(diffSeconds / secondsInUnit),
        unit,
      );
    }
  }
  return relativeTimeFormatter.format(Math.trunc(diffSeconds / 60), 'minute');
}

function renderTargetCell(record: AuditLogRecord) {
  const hideTarget =
    isFallbackTarget(record) &&
    TARGETLESS_FALLBACK_TARGET_TYPES.has(record.targetType);
  if (hideTarget) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="font-medium break-keep">{record.target}</span>
      {record.targetHandle ? (
        <span className="text-muted-foreground text-xs">
          @{record.targetHandle}
        </span>
      ) : null}
    </div>
  );
}

function renderContentCell(record: AuditLogRecord) {
  const { sentence } = describeAuditLog(record);
  const { label, variant } = resolveAuditLogActionBadge(record.action);
  const hideTargetReference =
    isFallbackTarget(record) &&
    TARGETLESS_FALLBACK_TARGET_TYPES.has(record.targetType);

  return (
    <div className="flex flex-col gap-1.5 py-0.5">
      <p className="text-sm leading-relaxed break-keep">
        <AuditLogSentence segments={sentence} />
      </p>
      <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
        <StatusBadge variant={variant} className="h-5 px-2 text-[11px]">
          {label}
        </StatusBadge>
        <span>{describeTargetType(record.targetType)}</span>
        {!hideTargetReference ? (
          <>
            <span aria-hidden="true">·</span>
            {!isFallbackTarget(record) ? (
              <span className="text-xs">{record.target}</span>
            ) : (
              <span className="font-mono text-xs">{record.targetId}</span>
            )}
          </>
        ) : null}
      </p>
    </div>
  );
}

export function createAuditLogColumns(
  now: Date,
): DataTableColumn<AuditLogRecord>[] {
  return [
    {
      id: 'occurredAt',
      header: '발생 일시',
      headClassName: 'hidden min-w-32 whitespace-nowrap md:table-cell',
      cellClassName:
        'hidden min-w-32 align-top whitespace-nowrap md:table-cell',
      cell: (record) => (
        <time dateTime={record.occurredAt} className="flex flex-col text-sm">
          <span>{formatRelativeTime(record.occurredAt, now)}</span>
          <span className="text-muted-foreground text-xs">
            {formatDate(record.occurredAt)}
          </span>
        </time>
      ),
    },
    {
      id: 'actor',
      header: '행위자',
      headClassName: 'hidden min-w-28 whitespace-nowrap md:table-cell',
      cellClassName: 'hidden min-w-28 align-top md:table-cell',
      cell: (record) => (
        <span className="text-sm font-medium break-keep">{record.actor}</span>
      ),
    },
    {
      id: 'target',
      header: '대상',
      headClassName: 'hidden min-w-36 md:table-cell',
      cellClassName: 'hidden min-w-36 align-top md:table-cell',
      cell: renderTargetCell,
    },
    {
      id: 'content',
      header: '내용',
      headClassName: 'min-w-0 md:min-w-64',
      cellClassName: 'min-w-0 align-top whitespace-normal md:min-w-64',
      cell: renderContentCell,
    },
  ];
}
