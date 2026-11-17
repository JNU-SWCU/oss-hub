'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, Pencil, Shield } from 'lucide-react';
import { PageHeader, StatusBadge, UserProfileCard } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ACCOUNT_STATUS_BADGE,
  ACCOUNT_STATUS_LABEL,
  roleBadgeVariant,
  roleLabel,
} from '@/lib/status-vocabulary';
import type { AdminAccessDetailData } from '../admin-access-detail-api';
import { adminAccessHistoryPageCount } from '../admin-access-detail-api';
import {
  accessListPath,
  type AccessWorkspace,
} from '../admin-access-list-query';
import { AdminAccessMutationConfirmDialog } from './admin-access-mutation-confirm-dialog';
import { AdminAccessMutationRejectDialog } from './admin-access-mutation-reject-dialog';
import {
  AdminAccessMutationActions,
  AdminAccessPendingRequestCard,
} from './admin-access-mutation-actions';
import { AdminAccessProfileSection } from './admin-access-profile-section';
import {
  LoginHistorySection,
  StaffAccessRequestHistorySection,
} from './admin-access-detail-history';
import {
  AdminAccessDetailError,
  AdminAccessDetailLoading,
  AdminAccessDetailNotFound,
  detailRootClassName,
  detailRootTag,
  detailSectionHeadingTag,
  type AdminAccessDetailLayoutContext,
} from './admin-access-detail-layout';
import {
  adminAccessMutationDialogCopy,
  type AdminAccessDetailMutationController,
} from './admin-access-detail-mutation';

export type AdminAccessDetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'not-found' }
  | ({ readonly kind: 'ready' } & AdminAccessDetailData);

type HistoryError = {
  readonly message: string;
  readonly onRetry: () => void;
};

function AdminAccessDetailContent({
  detail,
  history,
  mutation,
  layoutContext,
  workspace,
  listHref,
  historyLoading,
  historyError,
  onStaffAccessRequestPageChange,
  onLoginHistoryPageChange,
  onProfileSaved,
}: AdminAccessDetailData & {
  readonly mutation: AdminAccessDetailMutationController;
  readonly layoutContext: AdminAccessDetailLayoutContext;
  readonly workspace: AccessWorkspace;
  readonly listHref: string;
  readonly historyLoading: boolean;
  readonly historyError: HistoryError | null;
  readonly onStaffAccessRequestPageChange: (page: number) => void;
  readonly onLoginHistoryPageChange: (page: number) => void;
  readonly onProfileSaved: () => void;
}) {
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const profileEditTriggerRef = useRef<HTMLButtonElement>(null);
  const Root = detailRootTag(layoutContext);
  const isOverlay = layoutContext === 'overlay';
  const isQueue = workspace === 'queue';
  const sectionHeadingTag = detailSectionHeadingTag(layoutContext);
  const confirmDialog =
    mutation.confirmAction && mutation.confirmAction !== 'REJECT'
      ? {
          action: mutation.confirmAction,
          ...adminAccessMutationDialogCopy(mutation.confirmAction, detail),
        }
      : null;

  const closeProfileEdit = () => {
    setIsEditingProfile(false);
    profileEditTriggerRef.current?.focus();
  };

  const actions = (
    <>
      {detail.profile.isComplete ? null : (
        <p className="text-small text-muted-foreground">
          프로필 미완성 — 교직원 승인·부여 불가
        </p>
      )}
      {isEditingProfile ? (
        <AdminAccessProfileSection
          userId={detail.id}
          profile={detail.profile}
          onClose={closeProfileEdit}
          onSaved={onProfileSaved}
        />
      ) : null}
      <AdminAccessPendingRequestCard
        detail={detail}
        processingAction={mutation.processingAction}
        onRequestAction={mutation.onRequestAction}
      />
      {isQueue ? null : (
        <AdminAccessMutationActions
          detail={detail}
          headingTag={sectionHeadingTag}
          processingAction={mutation.processingAction}
          onRequestAction={mutation.onRequestAction}
        />
      )}
      <Card size="sm">
        {historyError ? (
          <CardContent>
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>이력 조회 실패</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{historyError.message}</p>
                <Button
                  variant="outline"
                  onClick={historyError.onRetry}
                  disabled={historyLoading}
                >
                  다시 시도
                </Button>
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : null}
        <CardContent>
          <StaffAccessRequestHistorySection
            items={history.staffAccessRequests.items}
            page={history.staffAccessRequests.page}
            totalPages={adminAccessHistoryPageCount(
              history.staffAccessRequests,
            )}
            isLoading={historyLoading}
            onPageChange={onStaffAccessRequestPageChange}
            headingTag={sectionHeadingTag}
          />
        </CardContent>
        <CardContent className="border-t border-border pt-(--card-spacing)">
          <LoginHistorySection
            items={history.loginHistory.items}
            page={history.loginHistory.page}
            totalPages={adminAccessHistoryPageCount(history.loginHistory)}
            isLoading={historyLoading}
            onPageChange={onLoginHistoryPageChange}
            headingTag={sectionHeadingTag}
          />
        </CardContent>
      </Card>
    </>
  );

  return (
    <Root
      className={detailRootClassName(
        layoutContext,
        'mx-auto flex w-full max-w-3xl flex-col gap-6 p-5 sm:p-8',
      )}
    >
      {mutation.conflictNotice ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>접근 상태가 변경되었습니다</AlertTitle>
          <AlertDescription>{mutation.conflictNotice}</AlertDescription>
        </Alert>
      ) : null}
      {mutation.successMessage ? (
        <div
          className="rounded-lg border border-border bg-background px-4 py-3 text-sm shadow-sm"
          role="status"
        >
          {mutation.successMessage}
        </div>
      ) : null}
      {isOverlay ? null : (
        <div className="grid gap-3">
          <Link
            href={listHref}
            className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {isQueue ? '가입 신청' : '사용자 목록'}
          </Link>
          <PageHeader title={isQueue ? '가입 신청 상세' : '사용자 상세'} />
        </div>
      )}
      <UserProfileCard
        profile={{
          name: detail.name,
          githubLogin: detail.githubLogin,
          memberKind: detail.memberKind,
          studentId: detail.profile.studentId,
          staffNumber: detail.profile.staffNumber,
          department: detail.profile.department,
          participations: detail.participations,
        }}
        badges={
          <>
            <StatusBadge variant={roleBadgeVariant(detail.role)}>
              {roleLabel(detail.role)}
            </StatusBadge>
            <StatusBadge variant={ACCOUNT_STATUS_BADGE[detail.accountStatus]}>
              {ACCOUNT_STATUS_LABEL[detail.accountStatus]}
            </StatusBadge>
          </>
        }
      />
      {isQueue ? (
        <div className="grid gap-4">{actions}</div>
      ) : (
        <aside
          aria-label="관리자 전용"
          className="grid gap-4 rounded-card bg-muted p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-small font-bold text-muted-foreground">
              <Shield aria-hidden="true" className="size-4" />
              관리자 전용
            </p>
            <Button
              ref={profileEditTriggerRef}
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={isEditingProfile}
              onClick={() => setIsEditingProfile((open) => !open)}
            >
              <Pencil aria-hidden="true" />
              프로필 수정
            </Button>
          </div>
          {actions}
        </aside>
      )}
      {mutation.confirmAction === 'REJECT' ? (
        <AdminAccessMutationRejectDialog
          githubLogin={detail.githubLogin}
          reason={mutation.rejectReason}
          isProcessing={mutation.processingAction === 'REJECT'}
          errorMessage={mutation.dialogError}
          onReasonChange={mutation.onReasonChange}
          onCancel={mutation.onCancel}
          onConfirm={mutation.onConfirm}
        />
      ) : null}
      {confirmDialog ? (
        <AdminAccessMutationConfirmDialog
          key={`${detail.id}-${confirmDialog.action}`}
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          destructive={confirmDialog.destructive}
          isProcessing={mutation.processingAction === confirmDialog.action}
          errorMessage={mutation.dialogError}
          onCancel={mutation.onCancel}
          onConfirm={mutation.onConfirm}
        />
      ) : null}
    </Root>
  );
}

export function AdminAccessDetailContentForState({
  state,
  onRetry,
  mutation,
  layoutContext = 'standalone',
  workspace = 'directory',
  listHref = accessListPath(workspace),
  historyLoading = false,
  historyError = null,
  onStaffAccessRequestPageChange = () => {},
  onLoginHistoryPageChange = () => {},
  onProfileSaved = () => {},
}: {
  readonly state: AdminAccessDetailState;
  readonly onRetry: () => void;
  readonly mutation: AdminAccessDetailMutationController;
  readonly layoutContext?: AdminAccessDetailLayoutContext;
  readonly workspace?: AccessWorkspace;
  readonly listHref?: string;
  readonly historyLoading?: boolean;
  readonly historyError?: HistoryError | null;
  readonly onStaffAccessRequestPageChange?: (page: number) => void;
  readonly onLoginHistoryPageChange?: (page: number) => void;
  readonly onProfileSaved?: () => void;
}) {
  if (state.kind === 'loading')
    return (
      <AdminAccessDetailLoading
        layoutContext={layoutContext}
        workspace={workspace}
      />
    );
  if (state.kind === 'error')
    return (
      <AdminAccessDetailError
        onRetry={onRetry}
        layoutContext={layoutContext}
        workspace={workspace}
      />
    );
  if (state.kind === 'not-found') {
    return (
      <AdminAccessDetailNotFound
        layoutContext={layoutContext}
        workspace={workspace}
      />
    );
  }
  return (
    <AdminAccessDetailContent
      detail={state.detail}
      history={state.history}
      mutation={mutation}
      layoutContext={layoutContext}
      workspace={workspace}
      listHref={listHref}
      historyLoading={historyLoading}
      historyError={historyError}
      onStaffAccessRequestPageChange={onStaffAccessRequestPageChange}
      onLoginHistoryPageChange={onLoginHistoryPageChange}
      onProfileSaved={onProfileSaved}
    />
  );
}
