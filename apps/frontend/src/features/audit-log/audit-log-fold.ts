import { dayKey } from './audit-log-format';
import type { AuditLogRecord } from './types';

const LOGIN_RUN_MIN_LENGTH = 2;

const LOGIN_RUN_MAX_GAP_MS = 60 * 60 * 1000;

export interface AuditFeedEvent {
  readonly kind: 'event';
  readonly key: string;
  readonly record: AuditLogRecord;
}

export interface AuditFeedRun {
  readonly kind: 'run';
  readonly key: string;
  readonly events: readonly AuditFeedEvent[];
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

export function auditLogRecordKey(record: AuditLogRecord): string {
  return JSON.stringify(record, (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }
    const fields = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(fields)
        .sort()
        .map((field) => [field, fields[field]]),
    );
  });
}

function compareDescending(left: string, right: string): number {
  return left === right ? 0 : left < right ? 1 : -1;
}

function compareAuditEvents(
  left: AuditFeedEvent,
  right: AuditFeedEvent,
): number {
  return (
    compareDescending(left.record.occurredAt, right.record.occurredAt) ||
    compareDescending(left.record.id, right.record.id) ||
    compareDescending(left.key, right.key)
  );
}

export function auditEvents(
  records: readonly AuditLogRecord[],
): readonly AuditFeedEvent[] {
  const occurrences = new Map<string, number>();
  return records.map((record) => {
    const payload = auditLogRecordKey(record);
    const occurrence = occurrences.get(payload) ?? 0;
    occurrences.set(payload, occurrence + 1);
    return {
      kind: 'event',
      key: occurrence === 0 ? payload : `${payload}:${occurrence}`,
      record,
    };
  });
}

function isFoldableLogin({ category, action }: AuditLogRecord): boolean {
  return (
    category === 'LOGIN' &&
    (action === 'LOGIN' || action === 'LOGOUT' || action === 'LOGIN_FAILED')
  );
}

function inRunWindow(newer: AuditLogRecord, older: AuditLogRecord): boolean {
  return (
    Date.parse(newer.occurredAt) - Date.parse(older.occurredAt) <=
    LOGIN_RUN_MAX_GAP_MS
  );
}

function runItems(run: readonly AuditFeedEvent[]): readonly AuditFeedItem[] {
  if (run.length < LOGIN_RUN_MIN_LENGTH) return run;
  const newest = run[0];
  const oldest = run[run.length - 1];
  const records = run.map((event) => event.record);
  const failures = records.filter(
    (record) => record.action === 'LOGIN_FAILED',
  ).length;
  return [
    {
      kind: 'run',
      key: `run:${oldest.key}`,
      events: run,
      failures,
      from: oldest.record.occurredAt,
      to: newest.record.occurredAt,
    },
  ];
}

export function foldAuditFeed(
  events: readonly AuditFeedEvent[],
  options: { readonly foldLogins: boolean },
): readonly AuditFeedDay[] {
  const days: { key: string; at: string; items: AuditFeedItem[] }[] = [];
  let run: AuditFeedEvent[] = [];
  const flush = () => {
    days.at(-1)?.items.push(...runItems(run));
    run = [];
  };
  for (const event of [...events].sort(compareAuditEvents)) {
    const { record } = event;
    const key = dayKey(record.occurredAt);
    if (days.at(-1)?.key !== key) {
      flush();
      days.push({ key, at: record.occurredAt, items: [] });
    }
    if (options.foldLogins && isFoldableLogin(record)) {
      const newer = run.at(-1);
      if (newer !== undefined && !inRunWindow(newer.record, record)) flush();
      run.push(event);
      continue;
    }
    flush();
    days.at(-1)?.items.push(event);
  }
  flush();
  return days;
}
