'use client';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import type { AdminAccessDetail } from '../admin-access-api';
import {
  deriveAdminAccessGuards,
  formatAdminAccessDateTime,
} from '../admin-access-detail-api';
import {
  ACCESS_STATE_LABEL,
  ACCOUNT_STATUS_LABEL,
  ROLE_LABEL,
  UNASSIGNED_ROLE_LABEL,
} from '@/lib/status-vocabulary';
import {
  ADMIN_ACCESS_MUTATION_ACTIONS,
  actionForAccountStatus,
  type AdminAccessMutationAction,
} from '../admin-access-mutation-policy';
import type { CanonicalAdminAccessDetail } from '../independent-authority-api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './role-select';

interface AdminAccessMutationActionsProps {
  readonly detail: CanonicalAdminAccessDetail;
  readonly processingAction: AdminAccessMutationAction | null;
  readonly onRequestAction: (action: AdminAccessMutationAction) => void;
}

export function AdminAccessMutationActions({
  detail,
  processingAction,
  onRequestAction,
}: AdminAccessMutationActionsProps) {
  const guards = deriveAdminAccessGuards(detail);
  const isProcessing = processingAction !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>접근 변경</CardTitle>
        <CardDescription>
          회원 유형, 관리자 접근, 계정 상태를 서로 독립적으로 변경합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <MemberKindControl
          detail={detail}
          processingAction={processingAction}
          blockedReason={
            guards.controlBlockedReason ??
            (detail.profile.isComplete
              ? null
              : '프로필(이름·학과·학번) 완성 후 회원 유형을 적용할 수 있습니다.')
          }
          onRequestAction={onRequestAction}
        />
        <StateControl
          controlId="admin-admin-access-control"
          label="관리자 접근"
          value={detail.hasAdminAccess ? 'GRANTED' : 'NONE'}
          disabled={isProcessing}
          options={[
            {
              value: 'NONE',
              label: ACCESS_STATE_LABEL.NONE,
              blockedReason: guards.adminRevokeBlockedReason,
            },
            {
              value: 'GRANTED',
              label: ACCESS_STATE_LABEL.GRANTED,
              blockedReason:
                guards.elevatedRoleBlockedReason !== null ? '' : null,
            },
          ]}
          onSelect={(next) =>
            onRequestAction(
              next === 'GRANTED'
                ? ADMIN_ACCESS_MUTATION_ACTIONS.GRANT_ADMIN_ACCESS
                : ADMIN_ACCESS_MUTATION_ACTIONS.REVOKE_ADMIN_ACCESS,
            )
          }
        />

        {guards.elevatedRoleBlockedReason && !detail.hasAdminAccess ? (
          <p className="text-sm text-muted-foreground">
            {guards.elevatedRoleBlockedReason}
          </p>
        ) : null}
        <StateControl
          controlId="admin-access-status-control"
          label="계정 상태"
          value={detail.accountStatus}
          disabled={isProcessing}
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
          onSelect={(accountStatus) =>
            onRequestAction(actionForAccountStatus(accountStatus))
          }
        />
      </CardContent>
    </Card>
  );
}

function MemberKindControl({
  detail,
  processingAction,
  blockedReason,
  onRequestAction,
}: {
  readonly detail: CanonicalAdminAccessDetail;
  readonly processingAction: AdminAccessMutationAction | null;
  readonly blockedReason: string | null;
  readonly onRequestAction: (action: AdminAccessMutationAction) => void;
}) {
  const isProcessing = processingAction !== null;
  const currentValue = detail.memberKind ?? 'UNCONFIRMED';
  const disabled =
    blockedReason !== null || isProcessing || detail.memberKind === null;

  return (
    <div className="grid gap-2">
      <label
        className="text-sm font-medium"
        htmlFor="admin-member-kind-control"
      >
        회원 유형
      </label>
      <Select
        value={currentValue}
        disabled={disabled}
        onValueChange={(nextValue) => {
          if (nextValue === 'STUDENT' && currentValue !== 'STUDENT') {
            onRequestAction(ADMIN_ACCESS_MUTATION_ACTIONS.SET_MEMBER_STUDENT);
          } else if (nextValue === 'STAFF' && currentValue !== 'STAFF') {
            onRequestAction(ADMIN_ACCESS_MUTATION_ACTIONS.SET_MEMBER_STAFF);
          }
        }}
      >
        <SelectTrigger id="admin-member-kind-control" className="h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="UNCONFIRMED" disabled>
            {UNASSIGNED_ROLE_LABEL}
          </SelectItem>
          <SelectItem value="STUDENT">{ROLE_LABEL.STUDENT}</SelectItem>
          <SelectItem value="STAFF">{ROLE_LABEL.STAFF}</SelectItem>
        </SelectContent>
      </Select>
      {blockedReason ? (
        <p className="text-sm text-muted-foreground">{blockedReason}</p>
      ) : null}
    </div>
  );
}

interface StateOption<TValue extends string> {
  readonly value: TValue;
  readonly label: string;

  readonly blockedReason: string | null;
}

function StateControl<TValue extends string>({
  controlId,
  label,
  value,
  options,
  disabled,
  onSelect,
}: {
  readonly controlId: string;
  readonly label: string;
  readonly value: TValue;
  readonly options: readonly StateOption<TValue>[];
  readonly disabled: boolean;
  readonly onSelect: (value: TValue) => void;
}) {
  const blockedReason =
    options.find(
      (option) =>
        option.value !== value &&
        option.blockedReason !== null &&
        option.blockedReason.length > 0,
    )?.blockedReason ?? null;
  const trigger = (
    <SelectTrigger id={controlId} className="h-11">
      <SelectValue />
    </SelectTrigger>
  );

  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium" htmlFor={controlId}>
        {label}
      </label>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          const selected = options.find((option) => option.value === next);
          if (
            selected &&
            selected.value !== value &&
            selected.blockedReason === null
          ) {
            onSelect(selected.value);
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

              disabled={option.value !== value && option.blockedReason !== null}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface AdminAccessPendingRequestCardProps {
  readonly detail: AdminAccessDetail;
  readonly processingAction: AdminAccessMutationAction | null;
  readonly onRequestAction: (action: AdminAccessMutationAction) => void;
}

export function AdminAccessPendingRequestCard({
  detail,
  processingAction,
  onRequestAction,
}: AdminAccessPendingRequestCardProps) {
  if (!detail.pendingRequest) return null;
  const isProcessing = processingAction !== null;

  const { approvalBlockedReason } = deriveAdminAccessGuards(detail);

  return (
    <Card>
      <CardHeader>
        <CardTitle>대기 중인 요청</CardTitle>
        <CardDescription>
          {formatAdminAccessDateTime(detail.pendingRequest.createdAt)}에 신청됨
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="h-11"
            disabled={isProcessing || approvalBlockedReason !== null}
            onClick={() =>
              onRequestAction(ADMIN_ACCESS_MUTATION_ACTIONS.APPROVE)
            }
          >
            승인
          </Button>
          <Button
            type="button"
            className="h-11"
            variant="destructive"
            disabled={isProcessing}
            onClick={() =>
              onRequestAction(ADMIN_ACCESS_MUTATION_ACTIONS.REJECT)
            }
          >
            반려
          </Button>
        </div>
        {approvalBlockedReason ? (
          <p className="text-sm text-muted-foreground">
            {approvalBlockedReason}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
