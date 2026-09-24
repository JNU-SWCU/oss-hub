'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Select } from '@/components/ui/select';

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
 * 묶음(교직원 접근·관리자 접근·계정 상태)마다 그 값이 가질 수 있는 상태 전부를
 * 드롭다운 하나에 담고, 지금 값이 그 안에서 고른 값으로 서 있다.
 *
 * 상태 글자 + 반대편 버튼 한 개(「허용」·「회수」)로 두었던 자리다. 그 모양은
 * 누를 수 있는 행동을 하나만 보여 주어, 그 값이 애초에 몇 가지인지와 누르면 어느
 * 상태로 가는지를 문구로 유추하게 만들었다. 드롭다운은 그 둘을 한 번에 보인다 —
 * 후행 상태가 목록에 이름으로 서 있고, 그것을 고르는 일이 곧 변경 요청이다.
 * 값마다 버튼을 하나씩 두고 지금 값 쪽을 채운 `disabled` 버튼으로 그리던 그 이전
 * 모양(#1365 이전)으로 돌아가지는 않는다 — 상태 문자열을 담은 `disabled` 버튼은
 * R-31 검출 신호였고, `<select>`의 지금 값은 버튼이 아니라 고른 값이다.
 *
 * 고르면 `onRequestAction`이 곷장 확인 다이얼로그를 열다(쓰기가 다이얼로그 없이
 * 실행되는 경로는 없다). `<select>`는 서버 값으로만 제어되므로 다이얼로그를
 * 취소하면 고른 값이 제자리로 돌아온다 — 화면이 아직 일어나지 않은 변경을
 * 이미 일어난 것처럼 말하지 않는다.
 *
 * 막힐 전환은 숨기지 않고 그 선택지만 `disabled`로 두며, 바로 아래에 이유를
 * 문장으로 보여준다 — 이미 응답에 들어있는 사실(대기 요청·본인 여부·프로필
 * 완료 여부)에 근거한 것이라 "런타임 상태 추측으로 affordance를 숨기는" 것과는
 * 다르다(`docs/rules/frontend.md`).
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
          // 본인이 자기 교직원 접근을 버려도 이 화면의 출입증은
          // `hasAdminAccess`라 화면을 잃지 않는다 — 여기서는 막지 않는다(#1382).
          revokeBlockedReason={null}
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
          // 대기 요청 안내문이 이미 카드 위에 떠 있으면 같은 말을 두 번 하지
          // 않는다 — 계정 상태 가드 문장도 같은 조건으로 숨는다.
          revokeBlockedReason={
            controlBlocked ? null : guards.adminRevokeBlockedReason
          }
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
        <StateControl
          controlId="admin-access-status-control"
          label="계정 상태"
          value={detail.accountStatus}
          disabled={controlBlocked || isProcessing}
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
              blockedReason: controlBlocked
                ? null
                : guards.deactivationBlockedReason,
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

function AuthorityControl({
  label,
  enabled,
  disabled,
  grantBlocked,
  revokeBlockedReason,
  onChange,
}: {
  readonly label: '교직원 접근' | '관리자 접근';
  readonly enabled: boolean;
  readonly disabled: boolean;
  readonly grantBlocked: boolean;
  /** 회수가 막혔을 때 선택 아래에 붙일 이유. 막히지 않으면 `null`. */
  readonly revokeBlockedReason: string | null;
  readonly onChange: (enabled: boolean) => void;
}) {
  return (
    <StateControl
      controlId={
        label === '교직원 접근'
          ? 'admin-staff-access-control'
          : 'admin-admin-access-control'
      }
      label={label}
      value={enabled ? 'GRANTED' : 'NONE'}
      disabled={disabled}
      options={[
        {
          value: 'NONE',
          label: ACCESS_STATE_LABEL.NONE,
          blockedReason: revokeBlockedReason,
        },
        {
          value: 'GRANTED',
          label: ACCESS_STATE_LABEL.GRANTED,
          blockedReason: grantBlocked
            ? // 문장은 카드가 한 번만 적는다(두 접근이 같은 사유로 막히므로).
              // 여기서는 고를 수 없다는 사실만 선택지에 표시한다.
              ''
            : null,
        },
      ]}
      onSelect={(next) => onChange(next === 'GRANTED')}
    />
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
 * `<select>`는 서버 값(`value`)으로만 제어된다 — 고르는 행위는 확인 다이얼로그를
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
  // 이유 문장은 **지금 값이 아닌** 선택지가 막혔을 때만 쓴다. 지금 값이 그 값이면
  // 그 금지는 아무것도 막고 있지 않아 "바꿀 수 없습니다"만 떠 있게 된다.
  const blockedReason =
    options.find(
      (option) =>
        option.value !== value &&
        option.blockedReason !== null &&
        option.blockedReason.length > 0,
    )?.blockedReason ?? null;

  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium" htmlFor={controlId}>
        {label}
      </label>
      <Select
        id={controlId}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value as TValue;
          if (next === value) {
            return;
          }
          onSelect(next);
        }}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            // 지금 값은 막히지 않는다 — 고를 수 없는 값이 선택된 상태로 서 있으면
            // 브라우저가 그 값을 목록에서 읽혀 주지 못한다.
            disabled={option.value !== value && option.blockedReason !== null}
          >
            {option.label}
          </option>
        ))}
      </Select>
      {blockedReason ? (
        <p className="text-sm text-muted-foreground">{blockedReason}</p>
      ) : null}
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
