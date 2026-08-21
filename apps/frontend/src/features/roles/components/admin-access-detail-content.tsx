import { AlertCircle } from 'lucide-react';
import { DetailPanelLayout } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { AdminAccessDetailData } from '../admin-access-detail-api';
import { adminAccessHistoryPageCount } from '../admin-access-detail-api';
import type { AccessWorkspace } from '../admin-access-list-query';
import { AdminAccessMutationConfirmDialog } from './admin-access-mutation-confirm-dialog';
import { AdminAccessMutationRejectDialog } from './admin-access-mutation-reject-dialog';
import {
  AdminAccessMutationActions,
  AdminAccessPendingRequestCard,
} from './admin-access-mutation-actions';
import { AdminAccessProfileSection } from './admin-access-profile-section';
import { AdminAccessDetailHeader } from './admin-access-detail-header';
import {
  LoginHistorySection,
  RoleRequestHistorySection,
} from './admin-access-detail-history';
import {
  AdminAccessDetailError,
  AdminAccessDetailLoading,
  AdminAccessDetailNotFound,
  detailHeadingTags,
  detailRootClassName,
  detailRootTag,
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

function AdminAccessDetailContent({
  detail,
  history,
  mutation,
  layoutContext,
  workspace,
  historyLoading,
  onRoleRequestPageChange,
  onLoginHistoryPageChange,
  onProfileSaved,
}: AdminAccessDetailData & {
  readonly mutation: AdminAccessDetailMutationController;
  readonly layoutContext: AdminAccessDetailLayoutContext;
  readonly workspace: AccessWorkspace;
  readonly historyLoading: boolean;
  readonly onRoleRequestPageChange: (page: number) => void;
  readonly onLoginHistoryPageChange: (page: number) => void;
  readonly onProfileSaved: () => void;
}) {
  const Root = detailRootTag(layoutContext);
  const isOverlay = layoutContext === 'overlay';
  const isQueue = workspace === 'queue';
  const heading = detailHeadingTags(layoutContext);
  const confirmDialog =
    mutation.confirmAction && mutation.confirmAction !== 'REJECT'
      ? {
          action: mutation.confirmAction,
          ...adminAccessMutationDialogCopy(mutation.confirmAction, detail),
        }
      : null;

  const editBlock = (
    <div className="grid gap-4">
      <section aria-labelledby="admin-access-profile" className="grid gap-3">
        <AdminAccessProfileSection
          userId={detail.id}
          profile={detail.profile}
          headingTag={heading.section}
          isOverlay={isOverlay}
          allowEdit={!isQueue}
          onSaved={onProfileSaved}
        />
      </section>
      <AdminAccessPendingRequestCard
        detail={detail}
        processingAction={mutation.processingAction}
        onRequestAction={mutation.onRequestAction}
      />
      {isQueue ? null : (
        <AdminAccessMutationActions
          detail={detail}
          processingAction={mutation.processingAction}
          onRequestAction={mutation.onRequestAction}
        />
      )}
    </div>
  );

  const historyBlock = (
    <div
      className={
        isOverlay ? 'grid gap-8 border-t border-border pt-8' : 'grid gap-8'
      }
    >
      <p className="text-xs font-semibold tracking-wide text-muted-foreground">
        이력
      </p>
      <RoleRequestHistorySection
        items={history.roleRequests.items}
        page={history.roleRequests.page}
        totalPages={adminAccessHistoryPageCount(history.roleRequests)}
        isLoading={historyLoading}
        onPageChange={onRoleRequestPageChange}
        headingTag={heading.section}
      />
      <LoginHistorySection
        items={history.loginHistory.items}
        page={history.loginHistory.page}
        totalPages={adminAccessHistoryPageCount(history.loginHistory)}
        isLoading={historyLoading}
        onPageChange={onLoginHistoryPageChange}
        headingTag={heading.section}
      />
    </div>
  );

  return (
    <Root
      className={detailRootClassName(
        layoutContext,
        'mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8',
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
      <AdminAccessDetailHeader detail={detail} layoutContext={layoutContext} />
      <DetailPanelLayout
        stacked={isOverlay}
        primary={isOverlay ? editBlock : historyBlock}
        secondary={isOverlay ? historyBlock : editBlock}
      />
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
          action={confirmDialog.action}
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
  historyLoading = false,
  onRoleRequestPageChange = () => {},
  onLoginHistoryPageChange = () => {},
  onProfileSaved = () => {},
}: {
  readonly state: AdminAccessDetailState;
  readonly onRetry: () => void;
  readonly mutation: AdminAccessDetailMutationController;
  readonly layoutContext?: AdminAccessDetailLayoutContext;
  readonly workspace?: AccessWorkspace;
  readonly historyLoading?: boolean;
  readonly onRoleRequestPageChange?: (page: number) => void;
  readonly onLoginHistoryPageChange?: (page: number) => void;
  readonly onProfileSaved?: () => void;
}) {
  if (state.kind === 'loading')
    return <AdminAccessDetailLoading layoutContext={layoutContext} />;
  if (state.kind === 'error')
    return (
      <AdminAccessDetailError onRetry={onRetry} layoutContext={layoutContext} />
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
      historyLoading={historyLoading}
      onRoleRequestPageChange={onRoleRequestPageChange}
      onLoginHistoryPageChange={onLoginHistoryPageChange}
      onProfileSaved={onProfileSaved}
    />
  );
}
