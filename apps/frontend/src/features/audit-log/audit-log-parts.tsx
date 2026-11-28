import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import {
  actionLabel,
  actorLabel,
  changeLabel,
  roleLabel,
  targetLabel,
  type ChangeLabel,
} from './audit-log-format';
import type { AuditLogRecord } from './types';

export function AuditLogActor({
  record,
}: {
  readonly record: AuditLogRecord;
}): ReactElement {
  const label = actorLabel(record);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span className={label.known ? 'font-semibold' : 'text-muted-foreground'}>
        {label.primary}
      </span>
      {label.handle ? (
        <span className="text-muted-foreground">@{label.handle}</span>
      ) : null}
    </span>
  );
}

export function AuditLogActorSearch({
  record,
  onSearchPerson,
}: {
  readonly record: AuditLogRecord;
  readonly onSearchPerson: (login: string) => void;
}): ReactElement {
  const login = record.actor?.login ?? null;
  if (login === null) return <AuditLogActor record={record} />;
  const label = actorLabel(record);
  const name = label.known ? label.primary : `@${login}`;
  return (
    <Button
      type="button"
      variant="link"
      size="content"
      className="relative z-10 font-semibold text-foreground"
      aria-label={`${name} 기록 검색`}
      onClick={() => onSearchPerson(login)}
    >
      {name}
    </Button>
  );
}

export function AuditLogRole({
  record,
}: {
  readonly record: AuditLogRecord;
}): ReactElement | null {
  const label = roleLabel(record.actor?.role ?? null);
  return label === null ? null : (
    <span className="text-muted-foreground">{label}</span>
  );
}

export function AuditLogTargetValue({
  record,
}: {
  readonly record: AuditLogRecord;
}): ReactElement | null {
  const label = targetLabel(record);
  if (label === null) return null;
  if (label.fallback) {
    return (
      <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">
        {label.primary}
      </code>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span className="font-semibold break-keep">{label.primary}</span>
      {label.handle ? (
        <span className="text-muted-foreground">@{label.handle}</span>
      ) : null}
      {label.context ? (
        <span className="text-muted-foreground break-keep">
          {label.context}
        </span>
      ) : null}
    </span>
  );
}

export function AuditLogActionValue({
  record,
}: {
  readonly record: AuditLogRecord;
}): ReactElement {
  const label = actionLabel(record);
  return label === record.action ? (
    <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">
      {label}
    </code>
  ) : (
    <span>{label}</span>
  );
}

export function AuditLogChange({
  label,
}: {
  readonly label: ChangeLabel;
}): ReactElement {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      {label.field ? (
        <span className="text-muted-foreground">{label.field}</span>
      ) : null}
      {label.before ? (
        <>
          <del className="text-muted-foreground">{label.before}</del>
          <span aria-hidden="true" className="text-muted-foreground">
            →
          </span>
        </>
      ) : null}
      {label.after ? (
        <strong className="font-semibold">{label.after}</strong>
      ) : null}
      {label.note ? (
        <span className="text-muted-foreground">{label.note}</span>
      ) : null}
    </span>
  );
}

export function AuditLogChangeValue({
  record,
}: {
  readonly record: AuditLogRecord;
}): ReactElement | null {
  const label = changeLabel(record);
  return label === null ? null : <AuditLogChange label={label} />;
}
