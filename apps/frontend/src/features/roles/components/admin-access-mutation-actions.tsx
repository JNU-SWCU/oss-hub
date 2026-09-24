'use client';

import { Button } from '@/components/ui/button';
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
} from '@/lib/status-vocabulary';
import {
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

/**
 * `/dashboard/users` 상세(04E)·오버레이(04F)가 공유하는 접근 변경 패널.
 * 묶음(교직원 접근·관리자 접근·계정 상태)마다 지금 값은 상태 글자로 읽히고,
 * 버튼은 반대 값으로 바꾸는 행동 하나만 선다(#1365). 예전에는 값마다 버튼이
 * 하나씩 있고 지금 값 쪽이 채운 버튼(`default`) + `disabled`였는데, 카드에서
 * 가장 진한 표면이 전부 누를 수 없는 것이 되어 R-31 검출 신호(상태 문자열을
 * 담은 `disabled` 버튼)에 그대로 걸렸다. 버튼 문구는 확인 다이얼로그·완료
 * 메시지가 쓰는 말(허용·회수·비활성화·재활성화)에 맞춘다.
 *
 * 버튼을 누르면 `onRequestAction`이 곧장 확인 다이얼로그를 연다(쓰기가
 * 다이얼로그 없이 실행되는 경로는 없다). 막힌 전환은 숨기지 않고 비활성화
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
  const nextAccountStatus =
    detail.accountStatus === 'ACTIVE' ? 'DEACTIVATED' : 'ACTIVE';

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
        {/*
          이유 문장은 실제로 막힌 버튼이 있을 때만 뜬다 — 두 접근이 이미 모두
          허용된 계정에서는 버튼이 둘 다 [회수]라 프로필 완료 여부가 아무것도
          막지 않는데 "부여할 수 없습니다"만 남는다(프로필 없는 시드 관리자
          계정이 정확히 이 상태다). 조건은 아래 버튼의 `disabled`와 같은 근거를
          본다.
        */}
        {!controlBlocked &&
        guards.elevatedRoleBlockedReason &&
        (!detail.hasStaffAccess || !detail.hasAdminAccess) ? (
          <p className="text-sm text-muted-foreground">
            {guards.elevatedRoleBlockedReason}
          </p>
        ) : null}
        <div
          className="grid gap-2"
          role="group"
          aria-labelledby="admin-access-status-control-label"
        >
          <span
            className="text-sm font-medium"
            id="admin-access-status-control-label"
          >
            계정 상태
          </span>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">
              {ACCOUNT_STATUS_LABEL[detail.accountStatus]}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                controlBlocked ||
                isProcessing ||
                (nextAccountStatus === 'DEACTIVATED' &&
                  guards.deactivationBlockedReason !== null)
              }
              onClick={() =>
                onRequestAction(actionForAccountStatus(nextAccountStatus))
              }
            >
              <span className="sr-only">계정 상태</span>{' '}
              {nextAccountStatus === 'DEACTIVATED' ? '비활성화' : '재활성화'}
            </Button>
          </div>
          {/* 같은 이유로 버튼이 [재활성화]일 때는 비활성화 가드 문장을 띄우지 않는다. */}
          {!controlBlocked &&
          nextAccountStatus === 'DEACTIVATED' &&
          guards.deactivationBlockedReason ? (
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
    // 라디오그룹을 걷어낸 자리를 `group`으로 메운다 — 상태 글자와 버튼이 묶음
    // 이름 아래 함께 읽히고, 라디오 의미(하나만 고름)는 되살아나지 않는다.
    <div className="grid gap-2" role="group" aria-labelledby={labelId}>
      <span className="text-sm font-medium" id={labelId}>
        {label}
      </span>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">
          {ACCESS_STATE_LABEL[enabled ? 'GRANTED' : 'NONE']}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || (!enabled && grantBlocked)}
          onClick={() => onChange(!enabled)}
        >
          <span className="sr-only">{label}</span> {enabled ? '회수' : '허용'}
        </Button>
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
