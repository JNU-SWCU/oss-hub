'use client';

import { useRef } from 'react';
import type { InlineAdminAccessMutationAction } from './use-inline-admin-access-mutation';
import { Button } from '@/components/ui/button';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ACCESS_STATE_LABEL,
  ACCOUNT_STATUS_LABEL,
  ROLE_LABEL,
  UNASSIGNED_ROLE_LABEL,
} from '@/lib/status-vocabulary';

import { deriveAdminAccessGuards } from '../admin-access-detail-api';
import {
  ADMIN_ACCESS_MUTATION_ACTIONS,
  type AdminAccessMutationAction,
} from '../admin-access-mutation-policy';
import type { AdminAccessDirectoryItem } from '../independent-authority-api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './access-select';

export type AdminAccessControlKind =
  'memberKind' | 'adminAccess' | 'accountStatus';

const LAYOUT = {
  field: { frame: 'grid gap-2', trigger: 'h-11' },
  cell: { frame: undefined, trigger: 'h-9 w-28' },
  stacked: {
    frame: 'grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2',
    trigger: 'h-11',
  },
} as const;

type AdminAccessControlProps = {
  readonly kind: AdminAccessControlKind;
  readonly target: AdminAccessDirectoryItem;
  readonly disabled: boolean;
  readonly idPrefix: string;
} & (
  | {
      readonly layout: 'field';
      readonly onRequestAction: (
        action: Exclude<AdminAccessMutationAction, 'APPROVE' | 'REJECT'>,
      ) => void;
    }
  | {
      readonly layout: 'cell' | 'stacked';
      readonly onRequestAction: (
        action: InlineAdminAccessMutationAction,
        trigger?: HTMLElement | null,
      ) => void;
    }
);

export function AdminAccessControl({
  kind,
  target,
  disabled,
  onRequestAction,
  layout,
  idPrefix,
}: AdminAccessControlProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const guards = deriveAdminAccessGuards(target);
  const isField = layout === 'field';
  if (kind === 'memberKind') {
    const controlId = idPrefix + '-member-kind-control';
    const label =
      layout !== 'cell' ? (
        <span className="text-sm font-medium" id={controlId + '-label'}>
          회원 유형
        </span>
      ) : null;
    const memberKind = (
      <span
        id={controlId}
        className="text-sm"
        {...(layout !== 'cell'
          ? { 'aria-labelledby': controlId + '-label' }
          : {})}
      >
        {target.memberKind
          ? ROLE_LABEL[target.memberKind]
          : UNASSIGNED_ROLE_LABEL}
      </span>
    );
    if (!isField)
      return (
        <div className={LAYOUT[layout].frame}>
          {label}
          {memberKind}
        </div>
      );
    const reason = target.isSelf
      ? '자신의 가입 유형은 되돌릴 수 없습니다.'
      : target.memberKind === null
        ? '선택된 가입 유형이 없습니다.'
        : target.hasAdminAccess
          ? '관리자 권한을 먼저 해제해 주세요.'
          : null;
    const reasonId = idPrefix + '-member-kind-reset-reason';
    return (
      <div className={LAYOUT.field.frame}>
        {label}
        <div className="grid min-w-0 max-w-44 gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {memberKind}
            <Button
              type="button"
              variant="destructive"
              size="xs"
              className="h-11"
              disabled={disabled || reason !== null}
              aria-describedby={reason ? reasonId : undefined}
              onClick={() =>
                onRequestAction(ADMIN_ACCESS_MUTATION_ACTIONS.RESET_MEMBER_KIND)
              }
            >
              가입 유형 되돌리기
            </Button>
          </div>
          {reason ? (
            <p
              id={reasonId}
              className="min-w-0 whitespace-normal break-words text-sm text-muted-foreground"
            >
              {reason}
            </p>
          ) : null}
        </div>
      </div>
    );
  }
  const controls = {
    adminAccess: {
      id: 'admin-access-control',
      label: '관리자 접근',
      value: target.hasAdminAccess ? 'GRANTED' : 'NONE',
      disabled: false,
      note: target.hasAdminAccess ? null : guards.elevatedRoleBlockedReason,
      options: [
        {
          value: 'NONE',
          label: ACCESS_STATE_LABEL.NONE,
          blockedReason: guards.adminRevokeBlockedReason,
          action: ADMIN_ACCESS_MUTATION_ACTIONS.REVOKE_ADMIN_ACCESS,
        },
        {
          value: 'GRANTED',
          label: ACCESS_STATE_LABEL.GRANTED,
          blockedReason:
            isField && guards.elevatedRoleBlockedReason !== null
              ? ''
              : guards.elevatedRoleBlockedReason,
          action: ADMIN_ACCESS_MUTATION_ACTIONS.GRANT_ADMIN_ACCESS,
        },
      ],
    },
    accountStatus: {
      id: 'access-status-control',
      label: '계정 상태',
      value: target.accountStatus,
      disabled: false,
      note: null,
      options: [
        {
          value: 'ACTIVE',
          label: ACCOUNT_STATUS_LABEL.ACTIVE,
          blockedReason: null,
          action: ADMIN_ACCESS_MUTATION_ACTIONS.SET_STATUS_ACTIVE,
        },
        {
          value: 'DEACTIVATED',
          label: ACCOUNT_STATUS_LABEL.DEACTIVATED,
          blockedReason: guards.deactivationBlockedReason,
          action: ADMIN_ACCESS_MUTATION_ACTIONS.SET_STATUS_DEACTIVATED,
        },
      ],
    },
  } as const;
  const control = controls[kind];
  const controlId = `${idPrefix}-${control.id}`;
  const blockedReason = control.options.find(
    (option) => option.value !== control.value && option.blockedReason,
  )?.blockedReason;
  const trigger = (
    <SelectTrigger
      ref={triggerRef}
      id={controlId}
      className={LAYOUT[layout].trigger}
      aria-label={
        layout === 'cell'
          ? `${target.name ?? target.githubLogin} ${control.label}`
          : undefined
      }
    >
      <SelectValue />
    </SelectTrigger>
  );

  return (
    <>
      <div
        className={LAYOUT[layout].frame}
        onClick={(event) => {
          if (!isField) event.stopPropagation();
        }}
      >
        {layout !== 'cell' ? (
          <label className="text-sm font-medium" htmlFor={controlId}>
            {control.label}
          </label>
        ) : null}
        <Select
          value={control.value}
          disabled={disabled || control.disabled}
          onValueChange={(next) => {
            const selected = control.options.find(
              (option) => option.value === next,
            );
            if (
              selected?.action &&
              selected.value !== control.value &&
              selected.blockedReason === null
            ) {
              if (isField) onRequestAction(selected.action);
              else onRequestAction(selected.action, triggerRef.current);
            }
          }}
        >
          {blockedReason ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                <TooltipContent>{blockedReason}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            trigger
          )}
          <SelectContent>
            {control.options.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={
                  option.action === null ||
                  (option.value !== control.value &&
                    option.blockedReason !== null)
                }
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isField && control.note ? (
        <p className="text-sm text-muted-foreground">{control.note}</p>
      ) : null}
    </>
  );
}
