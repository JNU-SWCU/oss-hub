import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import type { AdminAccessDetail, AdminAccessRole } from '../admin-access-api';
import {
  ADMIN_ACCESS_MUTATION_ACTIONS,
  ADMIN_ACCESS_MUTATION_ACTION_LABEL,
  adminAccessGrantTargetRole,
  adminAccessRevokeTargetRole,
  isAdminAccessMutationAvailable,
  type AdminAccessMutationAction,
} from '../admin-access-mutation-policy';

const ROLE_LABEL: Record<AdminAccessRole, string> = {
  STUDENT: '학생',
  STAFF: '교직원',
  ADMIN: '관리자',
};

const ACTION_ORDER: readonly AdminAccessMutationAction[] = [
  ADMIN_ACCESS_MUTATION_ACTIONS.APPROVE,
  ADMIN_ACCESS_MUTATION_ACTIONS.REJECT,
  ADMIN_ACCESS_MUTATION_ACTIONS.GRANT,
  ADMIN_ACCESS_MUTATION_ACTIONS.REVOKE,
  ADMIN_ACCESS_MUTATION_ACTIONS.REACTIVATE,
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
    const target = adminAccessRevokeTargetRole(role);
    return target ? `${ROLE_LABEL[target]}로 강등` : null;
  }
  return null;
}

interface AdminAccessMutationActionsProps {
  readonly detail: AdminAccessDetail;
  readonly processingAction: AdminAccessMutationAction | null;
  readonly onRequestAction: (action: AdminAccessMutationAction) => void;
}

/**
 * `/admin/access` 상세(04E)·오버레이(04F)가 공유하는 접근 변경 액션 패널
 * (PR04G). `admin-access-mutation-policy.ts`의 상태 머신으로 여섯 개 중
 * 현재 상태에서 실제로 유효한 액션만 버튼으로 노출한다 — 각 버튼은 바로
 * 쓰지 않고 해당 확인 다이얼로그를 여는 `onRequestAction`만 호출한다.
 */
export function AdminAccessMutationActions({
  detail,
  processingAction,
  onRequestAction,
}: AdminAccessMutationActionsProps) {
  const availableActions = ACTION_ORDER.filter((action) =>
    isAdminAccessMutationAvailable(action, detail),
  );

  if (availableActions.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>접근 변경</CardTitle>
        <CardDescription>모든 변경은 확인 후에만 적용됩니다.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {availableActions.map((action) => {
          const caption = actionCaption(action, detail.role);
          return (
            <Button
              key={action}
              type="button"
              className="h-11 justify-between"
              variant={
                DESTRUCTIVE_ACTIONS.has(action) ? 'destructive' : 'outline'
              }
              disabled={processingAction !== null}
              onClick={() => onRequestAction(action)}
            >
              <span>{ADMIN_ACCESS_MUTATION_ACTION_LABEL[action]}</span>
              {caption ? (
                <span className="text-xs text-muted-foreground">{caption}</span>
              ) : null}
            </Button>
          );
        })}
      </CardContent>
    </Card>
  );
}
