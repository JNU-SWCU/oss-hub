'use client';

import type { ReactElement, ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  actorLabel,
  changeLabel,
  formatFullDateTime,
  resultLabel,
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

function DetailRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-keep [overflow-wrap:anywhere]">
        {children}
      </dd>
    </>
  );
}

function DetailActor({
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
      className="font-semibold"
      aria-label={`${name} 기록 검색`}
      onClick={() => onSearchPerson(login)}
    >
      {name}
    </Button>
  );
}

export function AuditLogDetail({
  record,
  onClose,
  onSearchPerson,
}: {
  readonly record: AuditLogRecord;
  readonly onClose: () => void;
  readonly onSearchPerson: (login: string) => void;
}): ReactElement {
  return (
    <aside
      aria-label="기록 상세"
      className="flex flex-col gap-3 rounded-card p-4 ring-1 ring-foreground/10"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">기록 상세</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="닫기"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-table">
        <DetailRow label="시각">
          <time dateTime={record.occurredAt} className="tabular-nums">
            {formatFullDateTime(record.occurredAt)}
          </time>
        </DetailRow>
        <DetailRow label="행위자">
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
            <DetailActor record={record} onSearchPerson={onSearchPerson} />
            <AuditLogRole record={record} />
          </span>
        </DetailRow>
        <DetailRow label="작업">
          <AuditLogActionValue record={record} />
        </DetailRow>
        {targetLabel(record) === null ? null : (
          <DetailRow label="대상">
            <AuditLogTargetValue record={record} />
          </DetailRow>
        )}
        {changeLabel(record) === null ? null : (
          <DetailRow label="변경">
            <AuditLogChangeValue record={record} />
          </DetailRow>
        )}
        <DetailRow label="결과">{resultLabel(record)}</DetailRow>
        {record.requestId === null ? null : (
          <DetailRow label="요청 ID">
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
              {record.requestId}
            </code>
          </DetailRow>
        )}
      </dl>
    </aside>
  );
}
