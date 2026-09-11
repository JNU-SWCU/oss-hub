// @vitest-environment happy-dom

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDeactivationSection } from '@/features/profile/settings/components/account-deactivation-section';
import { ApplicationConfirmationDialog } from '@/features/programs/application-confirmation-dialog';
import { ApplicationDecisionDialog } from '@/features/programs/application-decision-dialog';
import { MilestoneDocumentResubmissionDialog } from '@/features/programs/milestone-document-resubmission-dialog';
import { ProgramAuthoringConfirmationDialog } from '@/features/programs/program-authoring-confirmation-dialog';
import { ProgramEditPurgeConfirmation } from '@/features/programs/program-edit-purge-confirmation';

const deactivate = vi.hoisted(() => vi.fn());
vi.mock(
  '@/features/profile/settings/account-deactivation-api',
  async (original) => ({
    ...(await original<
      typeof import('@/features/profile/settings/account-deactivation-api')
    >()),
    deactivateMyAccount: deactivate,
  }),
);

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const cases: readonly {
  readonly name: string;
  readonly trigger?: string;
  readonly render: (
    onCancel: () => void,
    onConfirm: () => void,
  ) => ReactElement;
}[] = [
  {
    name: '프로그램 생성',
    render: (onCancel, onConfirm) => (
      <ProgramAuthoringConfirmationDialog
        submitting={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    ),
  },
  ...(['submit', 'save', 'cancel'] as const).map((kind) => ({
    name: `신청 ${kind}`,
    render: (onCancel: () => void, onConfirm: () => void) => (
      <ApplicationConfirmationDialog
        kind={kind}
        submitting={false}
        onClose={onCancel}
        onConfirm={onConfirm}
        returnFocusRef={{ current: null }}
      />
    ),
  })),
  {
    name: '재제출',
    render: (onCancel, onConfirm) => (
      <MilestoneDocumentResubmissionDialog
        documentName="합성 결과 보고서"
        resubmissionDueAt="2027-06-30T14:59:59.000Z"
        submitting={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    ),
  },
  ...(
    [
      { action: 'APPROVE', currentStatus: 'SUBMITTED' },
      { action: 'REJECT', currentStatus: 'SUBMITTED' },
      { action: 'APPROVE', currentStatus: 'REJECTED' },
      { action: 'REJECT', currentStatus: 'APPROVED' },
    ] as const
  ).map(({ action, currentStatus }) => ({
    name: `신청 판정 ${currentStatus} → ${action}`,
    render: (onCancel: () => void, onConfirm: () => void) => (
      <ApplicationDecisionDialog
        action={action}
        currentStatus={currentStatus}
        applicantName="합성 신청자"
        teamName={null}
        repositoryProvisioningEnabled={false}
        repositoryConnectionMode="OWN"
        reason="합성 반려 사유"
        reasonError={false}
        busy={false}
        errorMessage={null}
        returnFocusId="synthetic-trigger"
        onReasonChange={vi.fn()}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    ),
  })),
  {
    name: '프로그램 삭제',
    render: (onCancel, onConfirm) => (
      <ProgramEditPurgeConfirmation
        programName="합성 프로그램"
        busy={false}
        purgeCounts={null}
        isPurgeScopeLoading={false}
        purgeScopeError={null}
        purgeError={null}
        onClose={onCancel}
        onConfirm={onConfirm}
      />
    ),
  },
  {
    name: '계정 비활성화',
    trigger: '계정 비활성화',
    render: (_onCancel, onConfirm) => (
      <AccountDeactivationSection
        hasAdminAccess={false}
        onDeactivated={onConfirm}
      />
    ),
  },
];

describe('확정하지 않고 닫는 공통 버튼 이름', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    deactivate.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it.each(cases)(
    '$name 확인창은 가시 텍스트 취소로 확정 없이 닫는다',
    async ({ render, trigger }) => {
      const onCancel = vi.fn();
      const onConfirm = vi.fn();
      await act(async () => root.render(render(onCancel, onConfirm)));
      if (trigger !== undefined) {
        const button = [...container.querySelectorAll('button')].find(
          (candidate) => candidate.textContent?.trim() === trigger,
        );
        if (button === undefined)
          throw new TypeError('확인창 열기 버튼이 없습니다.');
        await act(async () => button.click());
      }
      const dialog = document.querySelector('[role="alertdialog"]');
      if (dialog === null) throw new TypeError('확인창이 없습니다.');
      const cancel = [...dialog.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === '취소',
      );
      expect(cancel).toBeInstanceOf(HTMLButtonElement);
      if (cancel === undefined) throw new TypeError('취소 버튼이 없습니다.');
      expect(
        cancel.closest('[hidden], [aria-hidden="true"], .sr-only'),
      ).toBeNull();
      expect(cancel.disabled).toBe(false);

      await act(async () => cancel.click());

      expect(onConfirm).not.toHaveBeenCalled();
      expect(deactivate).not.toHaveBeenCalled();
      if (trigger === undefined) {
        await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
      } else {
        expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      }
    },
  );
});
