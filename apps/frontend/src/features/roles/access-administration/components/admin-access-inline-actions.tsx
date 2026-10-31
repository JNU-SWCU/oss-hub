'use client';

import type { ComponentType, MouseEvent } from 'react';
import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import type { AdminAccessMutationAction } from '../admin-access-mutation-policy';
import type { AdminAccessDirectoryItem } from '../independent-authority-api';
import {
  AccountStatusAccessControl,
  AdminAccessStateControl,
  MemberKindAccessControl,
  type AdminAccessControlLayout,
  type AdminAccessControlProps,
} from './admin-access-controls';
import type { InlineAdminAccessMutationAction } from './use-inline-admin-access-mutation';

export interface AdminAccessInlineActions {
  readonly onRequestAction: (
    item: AdminAccessDirectoryItem,
    action: InlineAdminAccessMutationAction,
    trigger: HTMLElement | null,
  ) => void;
  readonly successMessage: string | null;
  readonly conflictNotice: string | null;
  readonly actionError: string | null;
}

export interface AdminAccessListError {
  readonly message: string;
  readonly onRetry: () => void;
}

function isInlineAdminAccessMutationAction(
  action: AdminAccessMutationAction,
): action is InlineAdminAccessMutationAction {
  return action !== 'APPROVE' && action !== 'REJECT';
}

function stopRowClick(event: MouseEvent<HTMLDivElement>) {
  event.stopPropagation();
}

function inlineControlProps(
  item: AdminAccessDirectoryItem,
  inlineActions: AdminAccessInlineActions,
  layout: AdminAccessControlLayout,
  idPrefix: string,
): AdminAccessControlProps {
  return {
    target: item,
    disabled: false,
    layout,
    idPrefix,
    onRequestAction: (action, trigger) => {
      if (isInlineAdminAccessMutationAction(action)) {
        inlineActions.onRequestAction(item, action, trigger);
      }
    },
  };
}

export function AdminAccessInlineControlCell({
  item,
  control: Control,
  inlineActions,
}: {
  readonly item: AdminAccessDirectoryItem;
  readonly control: ComponentType<AdminAccessControlProps>;
  readonly inlineActions: AdminAccessInlineActions;
}) {
  return (
    <div className="w-fit" onClick={stopRowClick}>
      <Control
        {...inlineControlProps(
          item,
          inlineActions,
          'cell',
          `admin-access-row-${item.id}`,
        )}
      />
    </div>
  );
}

export function AdminAccessInlineControlStack({
  item,
  inlineActions,
}: {
  readonly item: AdminAccessDirectoryItem;
  readonly inlineActions: AdminAccessInlineActions;
}) {
  const props = inlineControlProps(
    item,
    inlineActions,
    'stacked',
    `admin-access-row-${item.id}-stacked`,
  );

  return (
    <div className="grid basis-full gap-2" onClick={stopRowClick}>
      <MemberKindAccessControl {...props} />
      <AdminAccessStateControl {...props} />
      <AccountStatusAccessControl {...props} />
    </div>
  );
}

export function AdminAccessListErrorAlert({
  error,
}: {
  readonly error: AdminAccessListError;
}) {
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>{error.message}</span>
        <Button className="h-11" variant="outline" onClick={error.onRetry}>
          다시 시도
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function AdminAccessInlineNotices({
  inlineActions,
  listError = null,
}: {
  readonly inlineActions: AdminAccessInlineActions;

  readonly listError?: AdminAccessListError | null;
}) {
  const { successMessage, conflictNotice, actionError } = inlineActions;
  if (!successMessage && !conflictNotice && !actionError && !listError) {
    return null;
  }

  return (
    <div className="sticky top-0 z-10 grid gap-3">
      {listError ? <AdminAccessListErrorAlert error={listError} /> : null}
      {conflictNotice ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>접근 상태가 변경되었습니다</AlertTitle>
          <AlertDescription>{conflictNotice}</AlertDescription>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}
      {successMessage ? (
        <div
          className="rounded-lg border border-border bg-background px-4 py-3 text-sm shadow-sm"
          role="status"
        >
          {successMessage}
        </div>
      ) : null}
    </div>
  );
}
