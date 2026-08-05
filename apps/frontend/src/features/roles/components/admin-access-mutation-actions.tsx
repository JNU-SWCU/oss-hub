'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

import type { AdminAccessDetail, AdminAccessRole } from '../admin-access-api';
import {
  ADMIN_ACCESS_MUTATION_ACTIONS,
  ADMIN_ACCESS_MUTATION_ACTION_LABEL,
  adminAccessGrantTargetRole,
  isAdminAccessMutationAvailable,
  type AdminAccessMutationAction,
} from '../admin-access-mutation-policy';
import { adminAccessRevocation } from '../admin-access-revocation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './role-select';

const ROLE_LABEL: Record<AdminAccessRole, string> = {
  STUDENT: '학생',
  STAFF: '교직원',
  ADMIN: '관리자',
};

/** 드롭다운에 나열되는 순서 — 결정(승인/반려) → 역할 변경(부여/회수) → 계정
 * 상태(재활성화/비활성화) 순으로 묶어 기존 버튼 스택의 그룹핑을 유지한다. */
const ACTION_ORDER: readonly AdminAccessMutationAction[] = [
  ADMIN_ACCESS_MUTATION_ACTIONS.APPROVE,
  ADMIN_ACCESS_MUTATION_ACTIONS.REJECT,
  ADMIN_ACCESS_MUTATION_ACTIONS.GRANT,
  ADMIN_ACCESS_MUTATION_ACTIONS.REVOKE,
  ADMIN_ACCESS_MUTATION_ACTIONS.REACTIVATE,
  ADMIN_ACCESS_MUTATION_ACTIONS.DEACTIVATE,
];

/** 처음 열었을 때 어떤 액션이 미리 선택돼 있을지 고르는 우선순위 — 되돌리기
 * 쉬운(비파괴적인) 액션을 항상 파괴적 액션보다 앞에 둔다. 그래서 예를 들어
 * 비활성 계정에서는 재활성화가, 대기 요청이 있으면 승인이 기본으로 뜨고,
 * 회수·비활성화 같은 파괴적 액션이 실수로 기본 선택되는 일이 없다.
 */
const DEFAULT_SELECTION_ORDER: readonly AdminAccessMutationAction[] = [
  ADMIN_ACCESS_MUTATION_ACTIONS.APPROVE,
  ADMIN_ACCESS_MUTATION_ACTIONS.REACTIVATE,
  ADMIN_ACCESS_MUTATION_ACTIONS.GRANT,
  ADMIN_ACCESS_MUTATION_ACTIONS.REVOKE,
  ADMIN_ACCESS_MUTATION_ACTIONS.REJECT,
  ADMIN_ACCESS_MUTATION_ACTIONS.DEACTIVATE,
];

const DESTRUCTIVE_ACTIONS = new Set<AdminAccessMutationAction>([
  ADMIN_ACCESS_MUTATION_ACTIONS.REJECT,
  ADMIN_ACCESS_MUTATION_ACTIONS.REVOKE,
  ADMIN_ACCESS_MUTATION_ACTIONS.DEACTIVATE,
]);

function actionCaption(
  action: AdminAccessMutationAction,
  role: AdminAccessRole | null,
): string | null {
  if (action === 'GRANT') {
    const target = adminAccessGrantTargetRole(role);
    return target ? `${ROLE_LABEL[target]}로 승격` : null;
  }
  if (action === 'REVOKE') {
    return adminAccessRevocation(role)?.actionCaption ?? null;
  }
  return null;
}

function actionOptionLabel(
  action: AdminAccessMutationAction,
  role: AdminAccessRole | null,
): string {
  const caption = actionCaption(action, role);
  const label = ADMIN_ACCESS_MUTATION_ACTION_LABEL[action];
  return caption ? `${label} (${caption})` : label;
}

/**
 * 학생을 관리자로 올리려는 관리자에게 남은 단계를 알려 주는 문구(#576).
 *
 * 승격은 `admin-access-mutation-policy.ts`의 `GRANT_TARGET_BY_RANK`대로 한
 * 단계씩만 일어나므로 학생을 고르면 부여 항목이 교직원만 가리킨다. 화면에는
 * "교직원로 승격"만 보이니 관리자까지 두 번 올려야 한다는 사실이 어디에도
 * 드러나지 않아, 관리자로 올리려던 사람이 한 번 부여하고 멈춘다. 사다리
 * 자체는 그대로 두고(2026-08-04 Tech Lead 판단) 남은 한 단계만 말해 준다.
 */
const TWO_STEP_ADMIN_PROMOTION_HINT =
  '관리자로 올리려면 먼저 교직원으로 올린 뒤 다시 관리자로 올려 주세요.';
const TWO_STEP_ADMIN_PROMOTION_HINT_ID = 'admin-access-two-step-admin-hint';

/**
 * 부여가 실제로 가능하고 그 대상이 교직원일 때만 참 — 즉 지금 보고 있는
 * 사람과 관리자 사이에 부여가 두 번 남은 경우다(학생, 그리고 아직 역할이
 * 없는 미지정 사용자). 교직원은 한 번이면 관리자가 되므로 안내할 다음
 * 단계가 없고, 관리자는 더 올라갈 곳이 없다. 부여 항목 자체가 없는 상태
 * (대기 중인 요청이 있어 결정이 먼저인 경우)에서는 없는 버튼을 가리키게
 * 되므로 함께 감춘다.
 */
function showsTwoStepAdminPromotionHint(detail: AdminAccessDetail): boolean {
  return (
    isAdminAccessMutationAvailable(
      ADMIN_ACCESS_MUTATION_ACTIONS.GRANT,
      detail,
    ) && adminAccessGrantTargetRole(detail.role) === 'STAFF'
  );
}

function defaultSelectedAction(
  availableActions: readonly AdminAccessMutationAction[],
): AdminAccessMutationAction | null {
  return (
    DEFAULT_SELECTION_ORDER.find((action) =>
      availableActions.includes(action),
    ) ??
    availableActions[0] ??
    null
  );
}

interface AdminAccessMutationActionsProps {
  readonly detail: AdminAccessDetail;
  readonly processingAction: AdminAccessMutationAction | null;
  readonly onRequestAction: (action: AdminAccessMutationAction) => void;
}

/**
 * `/admin/access` 상세(04E)·오버레이(04F)가 공유하는 접근 변경 패널
 * (PR04G, 드롭다운으로 정리). `admin-access-mutation-policy.ts`의 상태
 * 머신으로 여섯 개 중 현재 상태에서 실제로 유효한 액션만 드롭다운 항목으로
 * 노출하고, 관리자가 항목을 고른 뒤 "실행"을 눌러야만 해당 확인 다이얼로그가
 * 열린다 — 다이얼로그를 거치지 않고 바로 쓰기가 실행되는 경로는 없다.
 */
export function AdminAccessMutationActions({
  detail,
  processingAction,
  onRequestAction,
}: AdminAccessMutationActionsProps) {
  const availableActions = ACTION_ORDER.filter((action) =>
    isAdminAccessMutationAvailable(action, detail),
  );

  const [selectedAction, setSelectedAction] =
    useState<AdminAccessMutationAction | null>(null);

  const effectiveAction =
    selectedAction && availableActions.includes(selectedAction)
      ? selectedAction
      : defaultSelectedAction(availableActions);

  if (availableActions.length === 0 || effectiveAction === null) {
    return null;
  }

  const destructive = DESTRUCTIVE_ACTIONS.has(effectiveAction);
  const showsPromotionHint = showsTwoStepAdminPromotionHint(detail);

  return (
    <Card>
      <CardHeader>
        <CardTitle>접근 변경</CardTitle>
        <CardDescription>
          작업을 선택하고 실행을 누르면 확인 후에만 적용됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <label className="sr-only" htmlFor="admin-access-mutation-action">
          접근 변경 작업 선택
        </label>
        <Select
          value={effectiveAction}
          onValueChange={(value) =>
            setSelectedAction(value as AdminAccessMutationAction)
          }
        >
          <SelectTrigger
            id="admin-access-mutation-action"
            className="h-11"
            aria-describedby={
              showsPromotionHint ? TWO_STEP_ADMIN_PROMOTION_HINT_ID : undefined
            }
          >
            <SelectValue>
              <span className={cn(destructive && 'text-destructive')}>
                {actionOptionLabel(effectiveAction, detail.role)}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {availableActions.map((action) => (
              <SelectItem
                key={action}
                value={action}
                className={cn(
                  DESTRUCTIVE_ACTIONS.has(action) &&
                    'text-destructive focus:bg-destructive/10 focus:text-destructive-on-tint',
                )}
              >
                {actionOptionLabel(action, detail.role)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showsPromotionHint ? (
          <p
            id={TWO_STEP_ADMIN_PROMOTION_HINT_ID}
            data-slot="admin-access-two-step-admin-hint"
            className="text-sm text-muted-foreground"
          >
            {TWO_STEP_ADMIN_PROMOTION_HINT}
          </p>
        ) : null}
        <Button
          type="button"
          className="h-11"
          variant={destructive ? 'destructive' : 'default'}
          disabled={processingAction !== null}
          onClick={() => onRequestAction(effectiveAction)}
        >
          실행
        </Button>
      </CardContent>
    </Card>
  );
}
