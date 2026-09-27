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

/**
 * `/dashboard/users` 상세(04E)·오버레이(04F)가 공유하는 접근 변경 패널.
 * 회원 유형은 canonical `memberKind`를 기준으로 제어하고, 관리자 접근·계정 상태는
 * 각자의 독립 명령으로 유지한다. 선택은 확인 다이얼로그를 연 뒤 성공한 서버
 * 응답을 재조회할 때만 화면에 반영된다.
 */
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
        {/*
          이유 문장은 실제로 막힌 버튼이 있을 때만 뜬다 — 두 접근이 이미 모두
          허용된 계정에서는 버튼이 둘 다 [회수]라 프로필 완료 여부가 아무것도
          막지 않는데 "부여할 수 없습니다"만 남는다(프로필 없는 시드 관리자
          계정에서 정확히 이 상태다). 조건은 아래 버튼의 `disabled`와 같은 근거를
          본다.
        */}
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
              // 가드 문장은 지금 값이 「비활」일 때는 뜨지 않는다 — 막힌 선택지가
              // 이미 고른 값이면 아무것도 막지 않기 때문이다.
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
  /**
   * 이 값으로 바꿀 수 없을 때의 사유. 바꿀 수 있으면 `null`.
   * 빈 문자열은 「막혔지만 사유는 카드가 따로 적는다」는 뜻이다.
   */
  readonly blockedReason: string | null;
}

/**
 * 상태 하나를 그 값이 가질 수 있는 선택지 전부와 함께 보여 주는 드롭다운.
 *
 * Radix Select는 서버 값(`value`)으로만 제어된다 — 고르는 행위는 확인 다이얼로그를
 * 여는 **요청**일 뿐이고, 화면의 값은 서버가 바뀜 뒤에만 바뀜다. 취소하면 React가
 * 고른 값을 제자리로 되돌리므로, 일어나지 않은 변경이 화면에 남지 않는다.
 */
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
  // 비활성 선택지는 키보드로 접근할 수 없으므로 트리거의 hover/focus에서 이유를 알린다.
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
              // 지금 값은 막히지 않는다 — 고를 수 없는 값이 선택된 상태로 서 있으면
              // 목록에서 읽혀 주지 못한다.
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

/**
 * 대기 중인 요청이 있을 때 접근 변경 카드 위에 뜨는 결정 카드(PR04G).
 * 승인/반려 자체는 기존 `APPROVE`/`REJECT` request-builder 로직을 그대로
 * 쓴다 — 반려는 사유 입력이 필요해 `onRequestAction('REJECT')`가 열면
 * `AdminAccessMutationRejectDialog`가 뜨는 기존 흐름을 그대로 탄다.
 */
export function AdminAccessPendingRequestCard({
  detail,
  processingAction,
  onRequestAction,
}: AdminAccessPendingRequestCardProps) {
  if (!detail.pendingRequest) return null;
  const isProcessing = processingAction !== null;
  // [승인]은 역할과 계정 상태를 한 요청에 함께 담아 보내는데, 비활성 계정에서는
  // 그 명령이 서버에서 반드시 거절된다(#1381) — 큐의 교직원 승인자는 403
  // `ROL_004`, 관리자는 409 `ROL_014`다. 누르기 전에 막고 이유를 한 줄로 적는다.
  // [반려]는 역할도 상태도 바꾸지 않아 두 actor 모두 통과하므로 그대로 열어 둔다.
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
