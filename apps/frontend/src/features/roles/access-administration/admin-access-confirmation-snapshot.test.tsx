import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../../../test-support/render-with-query';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { adminDetail, adminHistory } from './admin-access-detail-test-fixture';
import { loadAdminAccessDetail } from './admin-access-detail-api';
import { executeAdminAccessMutation } from './admin-access-mutation-execution';
import { adminAccessDetailKey } from './queries';
import { AdminAccessDetailScreen } from './components/admin-access-detail-screen';
import type { AdminAccessDetailState } from './components/admin-access-detail-content';
import type { AdminAccessDetailMutationController } from './components/admin-access-detail-mutation';

vi.mock('./admin-access-detail-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./admin-access-detail-api')>()),
  loadAdminAccessDetail: vi.fn(),
}));
vi.mock('./admin-access-mutation-execution', () => ({
  executeAdminAccessMutation: vi.fn(),
}));
vi.mock('./components/admin-access-detail-content', () => ({
  AdminAccessDetailContentForState: ({
    state,
    mutation,
  }: {
    readonly state: AdminAccessDetailState;
    readonly mutation: AdminAccessDetailMutationController;
  }) =>
    state.kind === 'ready' ? (
      <div>
        <output>{state.detail.approvalRequestId}</output>
        <Button onClick={() => mutation.onRequestAction('RESET_MEMBER_KIND')}>
          Open
        </Button>
        {mutation.confirmAction ? (
          <Button onClick={() => mutation.onConfirm()}>Confirm</Button>
        ) : null}
        <div data-conflict={mutation.conflictNotice !== null}>
          {mutation.dialogError}
        </div>
      </div>
    ) : null,
}));

let mounted: Awaited<ReturnType<typeof renderWithQuery>> | undefined;
afterEach(async () => {
  await mounted?.unmount();
  vi.clearAllMocks();
});

it('keeps the confirmed approval tuple when background data replaces a request', async () => {
  const observed = adminDetail({
    hasStaffAccess: false,
    approvalStatus: 'PENDING',
    approvalRequestId: 'observed-request',
  });
  const replacement = { ...observed, approvalRequestId: 'replacement-request' };
  const history = adminHistory();
  vi.mocked(loadAdminAccessDetail).mockResolvedValue({
    detail: observed,
    history,
  });
  vi.mocked(executeAdminAccessMutation).mockRejectedValue(
    new ApiError({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'ROL_013',
      detail: 'Replacement request',
      instance: '/users/target/member-kind/reset',
    }),
  );
  const root = await renderWithQuery(
    <AdminAccessDetailScreen userId="target" />,
  );
  mounted = root;
  const open = root.container.querySelector('button');
  if (!open) throw new TypeError('Open action missing');
  await act(async () => open.click());

  vi.mocked(loadAdminAccessDetail).mockResolvedValue({
    detail: replacement,
    history,
  });
  await act(async () => {
    root.queryClient.setQueryData(adminAccessDetailKey('target'), {
      detail: replacement,
      history,
    });
  });
  expect(root.container.querySelector('output')?.textContent).toBe(
    'replacement-request',
  );
  const confirm = root.container.querySelectorAll('button')[1];
  if (!confirm) throw new TypeError('Confirmation action missing');

  await act(async () => confirm.click());

  expect(executeAdminAccessMutation).toHaveBeenCalledExactlyOnceWith(
    'target',
    'RESET_MEMBER_KIND',
    observed,
    '',
  );
  expect(root.container.querySelectorAll('button')).toHaveLength(2);
  expect(root.container.textContent).toContain('Replacement request');
});
