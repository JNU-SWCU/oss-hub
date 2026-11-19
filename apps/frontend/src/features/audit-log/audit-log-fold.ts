import { dayKey } from './audit-log-format';
import type { AuditLogRecord } from './types';

const LOGIN_RUN_MIN_LENGTH = 2;

const LOGIN_RUN_MAX_GAP_MS = 60 * 60 * 1000;

interface AuditFeedEvent {
  readonly kind: 'event';
  readonly key: string;
  readonly record: AuditLogRecord;
}

export interface AuditFeedRun {
  readonly kind: 'run';
  readonly key: string;
  readonly records: readonly AuditLogRecord[];
  readonly failures: number;
  readonly from: string;
  readonly to: string;
}

type AuditFeedItem = AuditFeedEvent | AuditFeedRun;

export interface AuditFeedDay {
  readonly key: string;
  readonly at: string;
  readonly items: readonly AuditFeedItem[];
}

function compareAuditRecords(
  left: AuditLogRecord,
  right: AuditLogRecord,
): number {
  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt < right.occurredAt ? 1 : -1;
  }
  if (left.id === right.id) return 0;
  return left.id < right.id ? 1 : -1;
}

function newestFirst(
  records: readonly AuditLogRecord[],
): readonly AuditLogRecord[] {
  const unique = new Map<string, AuditLogRecord>();
  for (const record of records) {
    if (!unique.has(record.id)) unique.set(record.id, record);
  }
  return [...unique.values()].sort(compareAuditRecords);
}

function inRunWindow(newer: AuditLogRecord, older: AuditLogRecord): boolean {
  return (
    Date.parse(newer.occurredAt) - Date.parse(older.occurredAt) <=
    LOGIN_RUN_MAX_GAP_MS
  );
}

function runItems(run: readonly AuditLogRecord[]): readonly AuditFeedItem[] {
  if (run.length < LOGIN_RUN_MIN_LENGTH) {
    return run.map((record) => ({ kind: 'event', key: record.id, record }));
  }
  const newest = run[0];
  const oldest = run[run.length - 1];
  return [
    {
      kind: 'run',
      key: `run:${oldest.id}`,
      records: run,
      failures: run.filter((record) => record.action === 'LOGIN_FAILED').length,
      from: oldest.occurredAt,
      to: newest.occurredAt,
    },
  ];
}

export function foldAuditFeed(
  records: readonly AuditLogRecord[],
  options: { readonly foldLogins: boolean },
): readonly AuditFeedDay[] {
  const days: { key: string; at: string; items: AuditFeedItem[] }[] = [];
  let run: AuditLogRecord[] = [];
  const flush = () => {
    days.at(-1)?.items.push(...runItems(run));
    run = [];
  };
  for (const record of newestFirst(records)) {
    const key = dayKey(record.occurredAt);
    if (days.at(-1)?.key !== key) {
      flush();
      days.push({ key, at: record.occurredAt, items: [] });
    }
    if (options.foldLogins && record.category === 'LOGIN') {
      const newer = run.at(-1);
      if (newer !== undefined && !inRunWindow(newer, record)) flush();
      run.push(record);
      continue;
    }
    flush();
    days.at(-1)?.items.push({ kind: 'event', key: record.id, record });
  }
  flush();
  return days;
}
