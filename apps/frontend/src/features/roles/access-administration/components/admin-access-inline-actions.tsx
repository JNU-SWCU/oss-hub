'use client';

import type { ComponentType, MouseEvent } from 'react';
import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

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
  ) => void;
  readonly successMessage: string | null;
  readonly conflictNotice: string | null;
  readonly actionError: string | null;
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
    onRequestAction: (action) => {
      if (isInlineAdminAccessMutationAction(action)) {
        inlineActions.onRequestAction(item, action);
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

export function AdminAccessInlineNotices({
  inlineActions,
}: {
  readonly inlineActions: AdminAccessInlineActions;
}) {
  const { successMessage, conflictNotice, actionError } = inlineActions;
  if (!successMessage && !conflictNotice && !actionError) return null;

  return (
    <div className="sticky top-0 z-10 grid gap-3">
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
