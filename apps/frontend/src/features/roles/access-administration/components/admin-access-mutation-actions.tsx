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
import type { DetailHeadingTag } from './admin-access-detail-layout';

const CONTROL_ROW_CLASS_NAME = 'grid gap-2 py-3 first:pt-0 last:pb-0';

interface AdminAccessMutationActionsProps {
  readonly detail: CanonicalAdminAccessDetail;
  readonly headingTag?: DetailHeadingTag;
  readonly processingAction: AdminAccessMutationAction | null;
  readonly onRequestAction: (action: AdminAccessMutationAction) => void;
}

export function AdminAccessMutationActions({
  detail,
  headingTag: HeadingTag = 'h2',
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
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <HeadingTag>접근 변경</HeadingTag>
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border/50">
        <div className={CONTROL_ROW_CLASS_NAME}>
          <AdminAccessControl kind="memberKind" {...controlProps} />
        </div>
        <div className={CONTROL_ROW_CLASS_NAME}>
          <AdminAccessControl kind="adminAccess" {...controlProps} />
        </div>
        <div className={CONTROL_ROW_CLASS_NAME}>
          <AdminAccessControl kind="accountStatus" {...controlProps} />
        </div>
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
    <Card size="sm">
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
