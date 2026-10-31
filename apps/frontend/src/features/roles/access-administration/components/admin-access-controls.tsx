'use client';

import { useRef } from 'react';

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
type AdminAccessControlLayout = 'field' | 'cell' | 'stacked';

const LAYOUT = {
  field: { frame: 'grid gap-2', trigger: 'h-11' },
  cell: { frame: undefined, trigger: 'h-9 w-28' },
  stacked: {
    frame: 'grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2',
    trigger: 'h-11',
  },
} as const;

export function AdminAccessControl({
  kind,
  target,
  disabled,
  onRequestAction,
  layout,
  idPrefix,
}: {
  readonly kind: AdminAccessControlKind;
  readonly target: AdminAccessDirectoryItem;
  readonly disabled: boolean;
  readonly onRequestAction: (
    action: Exclude<AdminAccessMutationAction, 'APPROVE' | 'REJECT'>,
    trigger?: HTMLElement | null,
  ) => void;
  readonly layout: AdminAccessControlLayout;
  readonly idPrefix: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const guards = deriveAdminAccessGuards(target);
  const isField = layout === 'field';
  const memberReason =
    guards.controlBlockedReason ??
    (guards.elevatedRoleBlockedReason === null
      ? null
      : '프로필(이름·학과·학번) 완성 후 회원 유형을 적용할 수 있습니다.');
  const controls = {
    memberKind: {
      id: 'member-kind-control',
      label: '회원 유형',
      value: target.memberKind ?? 'UNCONFIRMED',
      disabled: memberReason !== null || target.memberKind === null,
      note: memberReason,
      options: [
        {
          value: 'UNCONFIRMED',
          label: UNASSIGNED_ROLE_LABEL,
          blockedReason: '',
          action: null,
        },
        {
          value: 'STUDENT',
          label: ROLE_LABEL.STUDENT,
          blockedReason: null,
          action: ADMIN_ACCESS_MUTATION_ACTIONS.SET_MEMBER_STUDENT,
        },
        {
          value: 'STAFF',
          label: ROLE_LABEL.STAFF,
          blockedReason: null,
          action: ADMIN_ACCESS_MUTATION_ACTIONS.SET_MEMBER_STAFF,
        },
      ],
    },
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
  const isMemberKind = kind === 'memberKind';
  const blockedReason = isMemberKind
    ? memberReason
    : control.options.find(
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
      <div className={LAYOUT[layout].frame}>
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
          {blockedReason && (!isMemberKind || !isField) ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  {isMemberKind ? (
                    <span className="block" tabIndex={0}>
                      {trigger}
                    </span>
                  ) : (
                    trigger
                  )}
                </TooltipTrigger>
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
        {isField && isMemberKind && control.note ? (
          <p className="text-sm text-muted-foreground">{control.note}</p>
        ) : null}
      </div>
      {isField && !isMemberKind && control.note ? (
        <p className="text-sm text-muted-foreground">{control.note}</p>
      ) : null}
    </>
  );
}
