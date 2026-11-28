'use client';

import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { ListPanel } from '@/components';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  type AuditFeedEvent,
  type AuditFeedDay,
  type AuditFeedRun,
} from './audit-log-fold';
import {
  actionLabel,
  actorLabel,
  changeLines,
  dayLabel,
  formatFullDateTime,
  formatTime,
  formatTimeRange,
  targetLabel,
} from './audit-log-format';
import {
  AuditLogActionValue,
  AuditLogActorSearch,
  AuditLogChange,
  AuditLogRole,
  AuditLogTargetValue,
} from './audit-log-parts';

const ROW_CLASS =
  'relative flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-3 text-table sm:py-2';

const INDENT_CLASS = 'pl-10';

interface Disclosure {
  readonly open: boolean;
  readonly onToggle: () => void;
}

interface FeedActions {
  readonly openKeys: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly onSearchPerson: (login: string) => void;
}

function DisclosureToggle({
  open,
  onToggle,
  controls,
  label,
}: Disclosure & {
  readonly controls: string;
  readonly label: string;
}): ReactElement {
  return (
    <Button
      type="button"
      variant="bare"
      size="content"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      className="shrink-0 self-center after:absolute after:inset-0 after:content-['']"
      onClick={onToggle}
    >
      <ChevronRight
        aria-hidden="true"
        className={cn(
          'size-4 text-muted-foreground transition-transform',
          open && 'rotate-90',
        )}
      />
    </Button>
  );
}

function ToggleSlot({
  disclosure,
  controls,
  label,
}: {
  readonly disclosure: Disclosure | null;
  readonly controls: string;
  readonly label: string;
}): ReactNode {
  return disclosure ? (
    <DisclosureToggle {...disclosure} controls={controls} label={label} />
  ) : (
    <span aria-hidden="true" className="size-4 shrink-0" />
  );
}

function EventRow({
  event,
  nested,
  openKeys,
  onToggle,
  onSearchPerson,
}: FeedActions & {
  readonly event: AuditFeedEvent;
  readonly nested: boolean;
}): ReactElement {
  const detailId = useId();
  const { key, record } = event;
  const lines = changeLines(record);
  const [first, ...rest] = lines;
  const open = rest.length > 0 && openKeys.has(key);
  const disclosure =
    rest.length > 0 ? { open, onToggle: () => onToggle(key) } : null;
  const stamp = record.requestId
    ? `${formatFullDateTime(record.occurredAt)} · 요청 ${record.requestId}`
    : formatFullDateTime(record.occurredAt);
  return (
    <li className="border-t border-border/50">
      <div
        className={cn(
          ROW_CLASS,
          nested && INDENT_CLASS,
          disclosure && 'hover:bg-muted/50',
          open && 'bg-muted/50',
        )}
      >
        <ToggleSlot
          disclosure={disclosure}
          controls={detailId}
          label={`${actionLabel(record)} 변경 내용`}
        />
        <time
          dateTime={record.occurredAt}
          title={stamp}
          className="shrink-0 text-muted-foreground tabular-nums"
        >
          {formatTime(record.occurredAt)}
        </time>
        <AuditLogActorSearch record={record} onSearchPerson={onSearchPerson} />
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
        {first ? <AuditLogChange label={first} /> : null}
        {rest.length > 0 ? (
          <span className="text-muted-foreground tabular-nums">
            +{rest.length}
          </span>
        ) : null}
      </div>
      {disclosure ? (
        <dl
          id={detailId}
          hidden={!open}
          className={cn(
            'grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 bg-muted/50 pr-4 pb-3 text-table',
            nested ? 'pl-16' : INDENT_CLASS,
          )}
        >
          {rest.map((line) => (
            <div key={line.field ?? ''} className="contents">
              <dt className="text-muted-foreground">{line.field}</dt>
              <dd className="min-w-0 break-keep [overflow-wrap:anywhere]">
                <AuditLogChange label={{ ...line, field: null }} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

function RunActors({ run }: { readonly run: AuditFeedRun }): ReactNode {
  const names = [
    ...new Set(run.events.map((event) => actorLabel(event.record).primary)),
  ];
  const [first, ...others] = names;
  return (
    <span className="inline-flex items-baseline gap-x-1">
      <span className="font-semibold">{first}</span>
      {others.length > 0 ? (
        <span className="text-muted-foreground">외 {others.length}명</span>
      ) : null}
    </span>
  );
}

function RunRow({
  run,
  openKeys,
  onToggle,
  onSearchPerson,
}: FeedActions & {
  readonly run: AuditFeedRun;
}): ReactElement {
  const panelId = useId();
  const open = openKeys.has(run.key);
  return (
    <li className="border-t border-border/50">
      <div
        className={cn(ROW_CLASS, 'hover:bg-muted/50', open && 'bg-muted/50')}
      >
        <DisclosureToggle
          open={open}
          onToggle={() => onToggle(run.key)}
          controls={panelId}
          label={`로그인 ${run.events.length}건 펼치기`}
        />
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {formatTimeRange(run.from, run.to)}
        </span>
        <RunActors run={run} />
        <span>로그인 {run.events.length}건</span>
        {run.failures > 0 ? (
          <span className="text-destructive">실패 {run.failures}건</span>
        ) : null}
      </div>
      <ul id={panelId} hidden={!open} className="bg-muted/50">
        {open
          ? run.events.map((event) => (
              <EventRow
                key={event.key}
                event={event}
                nested
                openKeys={openKeys}
                onToggle={onToggle}
                onSearchPerson={onSearchPerson}
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
  onSearchPerson,
}: {
  readonly days: readonly AuditFeedDay[];
  readonly now: Date;
  readonly onSearchPerson: (login: string) => void;
}): ReactElement {
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(new Set());
  const onToggle = (key: string) =>
    setOpenKeys((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const actions: FeedActions = { openKeys, onToggle, onSearchPerson };
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
                    <RunRow key={item.key} run={item} {...actions} />
                  ) : (
                    <EventRow
                      key={item.key}
                      event={item}
                      nested={false}
                      {...actions}
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
