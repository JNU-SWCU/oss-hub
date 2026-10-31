'use client';

import { useRef, type ReactNode } from 'react';

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
  actionForAccountStatus,
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

export type AdminAccessControlLayout = 'field' | 'cell' | 'stacked';

export interface AdminAccessControlProps {
  readonly target: AdminAccessDirectoryItem;
  readonly disabled: boolean;
  readonly onRequestAction: (
    action: AdminAccessMutationAction,
    trigger?: HTMLElement | null,
  ) => void;
  readonly layout: AdminAccessControlLayout;
  readonly idPrefix: string;
}

function requestAction(
  props: Pick<AdminAccessControlProps, 'onRequestAction' | 'layout'>,
  action: AdminAccessMutationAction,
  trigger: HTMLElement | null,
): void {
  if (props.layout === 'field') {
    props.onRequestAction(action);
    return;
  }
  props.onRequestAction(action, trigger);
}

interface StateOption<TValue extends string> {
  readonly value: TValue;
  readonly label: string;
  readonly blockedReason: string | null;
}

const MEMBER_KIND_LABEL = '회원 유형';
const ADMIN_ACCESS_LABEL = '관리자 접근';
const ACCOUNT_STATUS_CONTROL_LABEL = '계정 상태';

function triggerClassName(layout: AdminAccessControlLayout): string {
  return layout === 'cell' ? 'h-9 w-28' : 'h-11';
}

function frameClassName(layout: AdminAccessControlLayout): string | undefined {
  switch (layout) {
    case 'cell':
      return undefined;
    case 'field':
      return 'grid gap-2';
    case 'stacked':
      return 'grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2';
  }
}

function ControlFrame({
  layout,
  controlId,
  label,
  target,
  children,
}: {
  readonly layout: AdminAccessControlLayout;
  readonly controlId: string;
  readonly label: string;
  readonly target: AdminAccessDirectoryItem;
  readonly children: (triggerProps: {
    readonly 'aria-label'?: string;
  }) => ReactNode;
}) {
  if (layout === 'cell') {
    return (
      <>
        {children({
          'aria-label': `${target.name ?? target.githubLogin} ${label}`,
        })}
      </>
    );
  }
  return (
    <>
      <label className="text-sm font-medium" htmlFor={controlId}>
        {label}
      </label>
      {children({})}
    </>
  );
}

export function MemberKindAccessControl({
  target,
  disabled,
  onRequestAction,
  layout,
  idPrefix,
}: AdminAccessControlProps) {
  const controlId = `${idPrefix}-member-kind-control`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const guards = deriveAdminAccessGuards(target);
  const blockedReason =
    guards.controlBlockedReason ??
    (guards.elevatedRoleBlockedReason === null
      ? null
      : '프로필(이름·학과·학번) 완성 후 회원 유형을 적용할 수 있습니다.');
  const currentValue = target.memberKind ?? 'UNCONFIRMED';
  const isDisabled =
    blockedReason !== null || disabled || target.memberKind === null;

  return (
    <div className={frameClassName(layout)}>
      <ControlFrame
        layout={layout}
        controlId={controlId}
        label={MEMBER_KIND_LABEL}
        target={target}
      >
        {(triggerProps) => {
          const trigger = (
            <SelectTrigger
              ref={triggerRef}
              id={controlId}
              className={triggerClassName(layout)}
              {...triggerProps}
            >
              <SelectValue />
            </SelectTrigger>
          );
          return (
            <Select
              value={currentValue}
              disabled={isDisabled}
              onValueChange={(nextValue) => {
                if (nextValue === 'STUDENT' && currentValue !== 'STUDENT') {
                  requestAction(
                    { onRequestAction, layout },
                    ADMIN_ACCESS_MUTATION_ACTIONS.SET_MEMBER_STUDENT,
                    triggerRef.current,
                  );
                } else if (nextValue === 'STAFF' && currentValue !== 'STAFF') {
                  requestAction(
                    { onRequestAction, layout },
                    ADMIN_ACCESS_MUTATION_ACTIONS.SET_MEMBER_STAFF,
                    triggerRef.current,
                  );
                }
              }}
            >
              {layout !== 'field' && blockedReason ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="block" tabIndex={0}>
                        {trigger}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{blockedReason}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                trigger
              )}
              <SelectContent>
                <SelectItem value="UNCONFIRMED" disabled>
                  {UNASSIGNED_ROLE_LABEL}
                </SelectItem>
                <SelectItem value="STUDENT">{ROLE_LABEL.STUDENT}</SelectItem>
                <SelectItem value="STAFF">{ROLE_LABEL.STAFF}</SelectItem>
              </SelectContent>
            </Select>
          );
        }}
      </ControlFrame>
      {layout === 'field' && blockedReason ? (
        <p className="text-sm text-muted-foreground">{blockedReason}</p>
      ) : null}
    </div>
  );
}

export function AdminAccessStateControl({
  target,
  disabled,
  onRequestAction,
  layout,
  idPrefix,
}: AdminAccessControlProps) {
  const guards = deriveAdminAccessGuards(target);
  const grantedBlockedReason =
    layout === 'field'
      ? guards.elevatedRoleBlockedReason !== null
        ? ''
        : null
      : guards.elevatedRoleBlockedReason;

  return (
    <>
      <StateControl
        layout={layout}
        target={target}
        controlId={`${idPrefix}-admin-access-control`}
        label={ADMIN_ACCESS_LABEL}
        value={target.hasAdminAccess ? 'GRANTED' : 'NONE'}
        disabled={disabled}
        options={[
          {
            value: 'NONE',
            label: ACCESS_STATE_LABEL.NONE,
            blockedReason: guards.adminRevokeBlockedReason,
          },
          {
            value: 'GRANTED',
            label: ACCESS_STATE_LABEL.GRANTED,
            blockedReason: grantedBlockedReason,
          },
        ]}
        onSelect={(next, trigger) =>
          requestAction(
            { onRequestAction, layout },
            next === 'GRANTED'
              ? ADMIN_ACCESS_MUTATION_ACTIONS.GRANT_ADMIN_ACCESS
              : ADMIN_ACCESS_MUTATION_ACTIONS.REVOKE_ADMIN_ACCESS,
            trigger,
          )
        }
      />
      {layout === 'field' &&
      guards.elevatedRoleBlockedReason &&
      !target.hasAdminAccess ? (
        <p className="text-sm text-muted-foreground">
          {guards.elevatedRoleBlockedReason}
        </p>
      ) : null}
    </>
  );
}

export function AccountStatusAccessControl({
  target,
  disabled,
  onRequestAction,
  layout,
  idPrefix,
}: AdminAccessControlProps) {
  const guards = deriveAdminAccessGuards(target);

  return (
    <StateControl
      layout={layout}
      target={target}
      controlId={`${idPrefix}-access-status-control`}
      label={ACCOUNT_STATUS_CONTROL_LABEL}
      value={target.accountStatus}
      disabled={disabled}
      options={[
        {
          value: 'ACTIVE',
          label: ACCOUNT_STATUS_LABEL.ACTIVE,
          blockedReason: null,
        },
        {
          value: 'DEACTIVATED',
          label: ACCOUNT_STATUS_LABEL.DEACTIVATED,
          blockedReason: guards.deactivationBlockedReason,
        },
      ]}
      onSelect={(accountStatus, trigger) =>
        requestAction(
          { onRequestAction, layout },
          actionForAccountStatus(accountStatus),
          trigger,
        )
      }
    />
  );
}

function StateControl<TValue extends string>({
  layout,
  target,
  controlId,
  label,
  value,
  options,
  disabled,
  onSelect,
}: {
  readonly layout: AdminAccessControlLayout;
  readonly target: AdminAccessDirectoryItem;
  readonly controlId: string;
  readonly label: string;
  readonly value: TValue;
  readonly options: readonly StateOption<TValue>[];
  readonly disabled: boolean;
  readonly onSelect: (value: TValue, trigger: HTMLElement | null) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const blockedReason =
    options.find(
      (option) =>
        option.value !== value &&
        option.blockedReason !== null &&
        option.blockedReason.length > 0,
    )?.blockedReason ?? null;

  return (
    <div className={frameClassName(layout)}>
      <ControlFrame
        layout={layout}
        controlId={controlId}
        label={label}
        target={target}
      >
        {(triggerProps) => {
          const trigger = (
            <SelectTrigger
              ref={triggerRef}
              id={controlId}
              className={triggerClassName(layout)}
              {...triggerProps}
            >
              <SelectValue />
            </SelectTrigger>
          );
          return (
            <Select
              value={value}
              disabled={disabled}
              onValueChange={(next) => {
                const selected = options.find(
                  (option) => option.value === next,
                );
                if (
                  selected &&
                  selected.value !== value &&
                  selected.blockedReason === null
                ) {
                  onSelect(selected.value, triggerRef.current);
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
                {options.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    disabled={
                      option.value !== value && option.blockedReason !== null
                    }
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }}
      </ControlFrame>
    </div>
  );
}
