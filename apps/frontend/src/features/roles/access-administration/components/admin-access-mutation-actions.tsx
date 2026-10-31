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
  ADMIN_ACCESS_MUTATION_ACTIONS,
  type AdminAccessMutationAction,
} from '../admin-access-mutation-policy';
import type { CanonicalAdminAccessDetail } from '../independent-authority-api';
import { AdminAccessControl } from './admin-access-controls';

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
  const controlProps = {
    target: detail,
    disabled: processingAction !== null,
    onRequestAction,
    layout: 'field',
    idPrefix: 'admin',
  } as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>접근 변경</CardTitle>
        <CardDescription>
          회원 유형, 관리자 접근, 계정 상태를 서로 독립적으로 변경합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <AdminAccessControl kind="memberKind" {...controlProps} />
        <AdminAccessControl kind="adminAccess" {...controlProps} />
        <AdminAccessControl kind="accountStatus" {...controlProps} />
      </CardContent>
    </Card>
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
