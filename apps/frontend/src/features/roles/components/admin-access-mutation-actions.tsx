'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import type {
  AdminAccessAccountStatus,
  AdminAccessDetail,
} from '../admin-access-api';
import {
  deriveAdminAccessGuards,
  formatAdminAccessDateTime,
} from '../admin-access-detail-api';
import {
  ACCOUNT_STATUS_LABEL,
  ADMIN_ACCESS_MUTATION_ACTIONS,
  actionForAccountStatus,
  type AdminAccessMutationAction,
} from '../admin-access-mutation-policy';
import type { CanonicalAdminAccessDetail } from '../independent-authority-api';

interface AdminAccessMutationActionsProps {
  readonly detail: CanonicalAdminAccessDetail;
  readonly processingAction: AdminAccessMutationAction | null;
  readonly onRequestAction: (action: AdminAccessMutationAction) => void;
}

const ACCOUNT_STATUS_ORDER: readonly AdminAccessAccountStatus[] = [
  'ACTIVE',
  'DEACTIVATED',
];

/**
 * `/admin/access` 상세(04E)·오버레이(04F)가 공유하는 접근 변경 패널
 * (PR04G, 직접 선택 방식으로 재설계). 드롭다운 대신 역할·계정 상태 각각을
 * 세그먼트 버튼으로 보여준다 — 현재 값은 채워진 버튼(`default`)으로만 표시되고,
 * 다른 값을 고르면 `onRequestAction`이 곧장 확인 다이얼로그를 연다(쓰기가
 * 다이얼로그 없이 실행되는 경로는 없다). 막힌 선택지는 숨기지 않고 비활성화
 * 상태로 두며, 바로 아래에 이유를 문장으로 보여준다 — 이미 응답에 들어있는
 * 사실(대기 요청·본인 여부·프로필 완료 여부)에 근거한 것이라
 * "런타임 상태 추측으로 affordance를 숨기는" 것과는 다르다(`docs/rules/frontend.md`).
 */
export function AdminAccessMutationActions({
  detail,
  processingAction,
  onRequestAction,
}: AdminAccessMutationActionsProps) {
  const guards = deriveAdminAccessGuards(detail);
  const controlBlocked = guards.controlBlockedReason !== null;
  const isProcessing = processingAction !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>접근 변경</CardTitle>
        <CardDescription>
          교직원 접근, 관리자 접근, 계정 상태를 서로 독립적으로 변경합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {controlBlocked ? (
          <p className="text-sm text-muted-foreground">
            {guards.controlBlockedReason}
          </p>
        ) : null}
        <AuthorityControl
          label="교직원 접근"
          enabled={detail.hasStaffAccess}
          disabled={controlBlocked || isProcessing}
          grantBlocked={guards.elevatedRoleBlockedReason !== null}
          onChange={(enabled) =>
            onRequestAction(
              enabled
                ? ADMIN_ACCESS_MUTATION_ACTIONS.GRANT_STAFF_ACCESS
                : ADMIN_ACCESS_MUTATION_ACTIONS.REVOKE_STAFF_ACCESS,
            )
          }
        />
        <AuthorityControl
          label="관리자 접근"
          enabled={detail.hasAdminAccess}
          disabled={controlBlocked || isProcessing}
          grantBlocked={guards.elevatedRoleBlockedReason !== null}
          onChange={(enabled) =>
            onRequestAction(
              enabled
                ? ADMIN_ACCESS_MUTATION_ACTIONS.GRANT_ADMIN_ACCESS
                : ADMIN_ACCESS_MUTATION_ACTIONS.REVOKE_ADMIN_ACCESS,
            )
          }
        />
        {!controlBlocked && guards.elevatedRoleBlockedReason ? (
          <p className="text-sm text-muted-foreground">
            {guards.elevatedRoleBlockedReason}
          </p>
        ) : null}
        <div className="grid gap-2">
          <span
            className="text-sm font-medium"
            id="admin-access-status-control-label"
          >
            계정 상태
          </span>
          <div
            role="radiogroup"
            aria-labelledby="admin-access-status-control-label"
            className="grid grid-cols-2 gap-2"
          >
            {ACCOUNT_STATUS_ORDER.map((status) => {
              const isCurrent = detail.accountStatus === status;
              const disabled =
                isCurrent ||
                controlBlocked ||
                isProcessing ||
                (status === 'DEACTIVATED' &&
                  guards.deactivationBlockedReason !== null);
              return (
                <Button
                  key={status}
                  type="button"
                  role="radio"
                  aria-checked={isCurrent}
                  variant={isCurrent ? 'default' : 'outline'}
                  size="sm"
                  className="h-auto min-h-10 w-full px-2 py-1.5"
                  disabled={disabled}
                  onClick={() =>
                    onRequestAction(actionForAccountStatus(status))
                  }
                >
                  {ACCOUNT_STATUS_LABEL[status]}
                </Button>
              );
            })}
          </div>
          {!controlBlocked && guards.deactivationBlockedReason ? (
            <p className="text-sm text-muted-foreground">
              {guards.deactivationBlockedReason}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function AuthorityControl({
  label,
  enabled,
  disabled,
  grantBlocked,
  onChange,
}: {
  readonly label: '교직원 접근' | '관리자 접근';
  readonly enabled: boolean;
  readonly disabled: boolean;
  readonly grantBlocked: boolean;
  readonly onChange: (enabled: boolean) => void;
}) {
  const labelId =
    label === '교직원 접근'
      ? 'admin-staff-access-control-label'
      : 'admin-admin-access-control-label';
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium" id={labelId}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="grid grid-cols-2 gap-2"
      >
        {[true, false].map((nextEnabled) => {
          const isCurrent = enabled === nextEnabled;
          return (
            <Button
              key={String(nextEnabled)}
              type="button"
              role="radio"
              aria-checked={isCurrent}
              variant={isCurrent ? 'default' : 'outline'}
              size="sm"
              className="h-auto min-h-10 w-full px-2 py-1.5"
              disabled={disabled || isCurrent || (nextEnabled && grantBlocked)}
              onClick={() => onChange(nextEnabled)}
            >
              <span className="sr-only">{label}</span>
              {nextEnabled ? '허용' : '해제'}
            </Button>
          );
        })}
      </div>
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>대기 중인 요청</CardTitle>
        <CardDescription>
          {formatAdminAccessDateTime(detail.pendingRequest.createdAt)}에 신청됨
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-11"
          disabled={isProcessing}
          onClick={() => onRequestAction(ADMIN_ACCESS_MUTATION_ACTIONS.APPROVE)}
        >
          승인
        </Button>
        <Button
          type="button"
          className="h-11"
          variant="destructive"
          disabled={isProcessing}
          onClick={() => onRequestAction(ADMIN_ACCESS_MUTATION_ACTIONS.REJECT)}
        >
          반려
        </Button>
      </CardContent>
    </Card>
  );
}
