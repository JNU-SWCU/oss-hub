'use client';

import {
  useId,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { AUDIT_LOG_PERIOD_LABELS } from './audit-log-format';
import {
  AUDIT_LOG_ACTION_LABELS,
  AUDIT_LOG_ACTIONS,
  AUDIT_LOG_PERIODS,
  type AuditLogFilters,
  type AuditLogPeriod,
} from './types';

function Field({
  id,
  label,
  className,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly className: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

export function AuditLogFilterFields({
  filters,
  onChange,
  onDraft,
  onSearch,
}: {
  readonly filters: AuditLogFilters;
  readonly onChange: (filters: AuditLogFilters) => void;
  readonly onDraft: (filters: AuditLogFilters) => void;
  readonly onSearch?: () => void;
}): ReactElement {
  const id = useId();
  return (
    <>
      <Field id={`${id}-period`} label="기간" className="sm:w-36">
        <Select
          id={`${id}-period`}
          value={filters.period}
          onChange={(event) =>
            onChange({
              ...filters,
              period: event.target.value as AuditLogPeriod,
            })
          }
        >
          {AUDIT_LOG_PERIODS.map((period) => (
            <option key={period} value={period}>
              {AUDIT_LOG_PERIOD_LABELS[period]}
            </option>
          ))}
        </Select>
      </Field>
      {filters.period === 'custom' ? (
        <>
          <Field id={`${id}-from`} label="시작일" className="sm:w-44">
            <Input
              id={`${id}-from`}
              type="date"
              value={filters.from}
              onChange={(event) =>
                onChange({ ...filters, from: event.target.value })
              }
            />
          </Field>
          <Field id={`${id}-to`} label="종료일" className="sm:w-44">
            <Input
              id={`${id}-to`}
              type="date"
              value={filters.to}
              onChange={(event) =>
                onChange({ ...filters, to: event.target.value })
              }
            />
          </Field>
        </>
      ) : null}
      <Field id={`${id}-action`} label="작업 종류" className="sm:w-52">
        <Select
          id={`${id}-action`}
          value={filters.action}
          onChange={(event) =>
            onChange({ ...filters, action: event.target.value })
          }
        >
          <option value="">전체</option>
          {AUDIT_LOG_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {AUDIT_LOG_ACTION_LABELS[action]}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={`${id}-q`} label="검색" className="sm:w-72">
        <Input
          id={`${id}-q`}
          type="search"
          value={filters.q}
          onChange={(event) => onDraft({ ...filters, q: event.target.value })}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || onSearch === undefined) return;
            event.preventDefault();
            onSearch();
          }}
          placeholder="이름 또는 GitHub 아이디"
        />
      </Field>
    </>
  );
}

const SHEET_CLASS = cn(
  'fixed inset-x-0 bottom-0 z-50 max-h-sheet-max overflow-y-auto rounded-t-card',
  'border-t border-border bg-background pb-safe-bottom shadow-lg outline-none',
);

export function AuditLogFilterSheet({
  open,
  filters,
  onChange,
  onApply,
  onCancel,
}: {
  readonly open: boolean;
  readonly filters: AuditLogFilters;
  readonly onChange: (filters: AuditLogFilters) => void;
  readonly onApply: () => void;
  readonly onCancel: () => void;
}): ReactElement {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onApply();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="bg-overlay backdrop-blur-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={SHEET_CLASS}
        >
          <form className="flex flex-col gap-4 p-5" onSubmit={submit}>
            <DialogTitle>필터</DialogTitle>
            <AuditLogFilterFields
              filters={filters}
              onChange={onChange}
              onDraft={onChange}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onCancel}>
                취소
              </Button>
              <Button type="submit">적용</Button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
