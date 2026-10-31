import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Button } from '@/components/ui/button';

import { fetchCanonicalAdminAccessDetail } from '../independent-authority-api';
import type { CanonicalAdminAccessDetail } from '../independent-authority-api';
import { runAdminAccessMutation } from '../admin-access-mutation-outcome';
import type { AdminAccessMutationOutcome } from '../admin-access-mutation-outcome';
import { adminAccessMutationSuccessMessage } from '../admin-access-mutation-policy';
import { useInlineAdminAccessMutation } from './use-inline-admin-access-mutation';

vi.mock('../independent-authority-api', () => ({
  fetchCanonicalAdminAccessDetail: vi.fn(),
}));
vi.mock('../admin-access-mutation-outcome', () => ({
  runAdminAccessMutation: vi.fn(),
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const detail: CanonicalAdminAccessDetail = {
  id: 'synthetic-user',
  githubLogin: 'synthetic-user',
  name: '합성 사용자',
  role: 'STAFF',
  memberKind: 'STAFF',
  hasStaffAccess: true,
  hasAdminAccess: false,
  accountStatus: 'ACTIVE',
  isSelf: false,
  isProfileComplete: true,
  createdAt: '2026-07-29T00:00:00.000Z',
  pendingRequest: null,
  lastLoginAt: null,
  profile: {
    name: '합성 사용자',
    studentId: null,
    department: '소프트웨어공학과',
    staffNumber: '123456',
    isComplete: true,
  },
};
const action = 'SET_MEMBER_STUDENT';
const fields = { studentId: '123456', department: '소프트웨어공학과' };
let container: HTMLDivElement;
let root: Root;
let current: ReturnType<typeof useInlineAdminAccessMutation>;
const onChanged = vi.fn();

function Harness() {
  current = useInlineAdminAccessMutation(onChanged);
  return (
    <Button
      onClick={(event) =>
        void current.request(detail, action, event.currentTarget)
      }
    >
      변경
    </Button>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function open() {
  vi.mocked(fetchCanonicalAdminAccessDetail).mockResolvedValueOnce(detail);
  await act(async () => current.request(detail, action, null));
}

describe('useInlineAdminAccessMutation', () => {
  it('ignores a duplicate request during fetch and keeps trigger focus', async () => {
    const fetchResult = Promise.withResolvers<CanonicalAdminAccessDetail>();
    vi.mocked(fetchCanonicalAdminAccessDetail).mockReturnValueOnce(fetchResult.promise);
    const trigger = container.querySelector('button');
    trigger?.focus();

    act(() => {
      trigger?.click();
      void current.request(detail, action, null);
    });
    expect(current.openingUserId).toBe(detail.id);
    expect(current.pending).toBeNull();
    expect(fetchCanonicalAdminAccessDetail).toHaveBeenCalledTimes(1);
    expect(trigger?.disabled).toBe(false);
    expect(document.activeElement).toBe(trigger);

    await act(async () => fetchResult.resolve(detail));
    expect(current.openingUserId).toBeNull();
    expect(current.pending).toEqual({ action, detail, returnFocusTo: trigger });
    expect(document.activeElement).toBe(trigger);
    await act(async () => current.request(detail, action, null));
    expect(fetchCanonicalAdminAccessDetail).toHaveBeenCalledTimes(1);
  });

  it.each([
    { memberKind: 'STUDENT' as const },
    { hasAdminAccess: true },
    { accountStatus: 'DEACTIVATED' as const },
    { pendingRequest: { id: 'new-request', status: 'PENDING' as const, createdAt: detail.createdAt } },
  ])('refreshes without opening a dialog when fresh fields differ: %j', async (change) => {
    vi.mocked(fetchCanonicalAdminAccessDetail).mockResolvedValueOnce({ ...detail, ...change });

    await act(async () => current.request(detail, action, null));

    expect(current.pending).toBeNull();
    expect(current.conflictNotice).toBeTruthy();
    expect(current.successMessage).toBeNull();
    expect(runAdminAccessMutation).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('reports fetch failure outside the dialog and permits another request', async () => {
    vi.mocked(fetchCanonicalAdminAccessDetail).mockRejectedValueOnce(new TypeError('Network failed'));

    await act(async () => current.request(detail, action, null));

    expect(current.actionError).toBeTruthy();
    expect(current.pending).toBeNull();
    expect(current.openingUserId).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
    await open();
    expect(current.actionError).toBeNull();
    expect(current.pending).not.toBeNull();
  });

  it('cancels a dialog without mutation or refresh and permits reopening', async () => {
    await open();

    act(() => current.cancel());

    expect(current.pending).toBeNull();
    expect(runAdminAccessMutation).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    await open();
    expect(current.pending).not.toBeNull();
  });

  it('sends fresh detail and fields once, closes on success, and clears success after four seconds', async () => {
    await open();
    const mutation = Promise.withResolvers<AdminAccessMutationOutcome>();
    vi.mocked(runAdminAccessMutation).mockReturnValueOnce(mutation.promise);

    act(() => {
      void current.confirm(fields);
      void current.confirm(fields);
      void current.request(detail, action, null);
      current.cancel();
    });
    expect(current.isProcessing).toBe(true);
    expect(current.pending).not.toBeNull();
    expect(runAdminAccessMutation).toHaveBeenCalledTimes(1);
    expect(runAdminAccessMutation).toHaveBeenCalledWith({
      userId: detail.id, action, detail, reason: '', memberKindFields: fields,
    });
    expect(fetchCanonicalAdminAccessDetail).toHaveBeenCalledTimes(1);
    await act(async () => mutation.resolve({ kind: 'success', result: null }));

    expect(current.pending).toBeNull();
    expect(current.isProcessing).toBe(false);
    expect(current.successMessage).toBe(adminAccessMutationSuccessMessage(action, detail.githubLogin));
    expect(onChanged).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(3_999); });
    expect(current.successMessage).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(current.successMessage).toBeNull();
  });

  it.each([
    null,
    { id: detail.id, role: detail.role, accountStatus: detail.accountStatus, pendingRequest: null },
  ])('closes and refreshes on conflict with projection %j', async (projection) => {
    await open();
    vi.mocked(runAdminAccessMutation).mockResolvedValueOnce({ kind: 'conflict', projection });

    await act(async () => current.confirm());

    expect(current.pending).toBeNull();
    expect(current.conflictNotice).toBeTruthy();
    expect(current.dialogError).toBeNull();
    expect(current.successMessage).toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(1);
    await open();
    expect(current.conflictNotice).toBeNull();
  });

  it('keeps the dialog open with an error while refreshing the list', async () => {
    await open();
    vi.mocked(runAdminAccessMutation).mockResolvedValueOnce({ kind: 'error', message: 'synthetic-error' });

    await act(async () => current.confirm(fields));

    expect(current.pending).toEqual({ action, detail, returnFocusTo: null });
    expect(current.dialogError).toBe('synthetic-error');
    expect(current.isProcessing).toBe(false);
    expect(current.successMessage).toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(1);
    act(() => current.cancel());
    expect(current.dialogError).toBeNull();
  });

  it.each(['resolve', 'reject'] as const)('aborts fetch and ignores late %s after unmount', async (outcome) => {
    const fetchResult = Promise.withResolvers<CanonicalAdminAccessDetail>();
    vi.mocked(fetchCanonicalAdminAccessDetail).mockReturnValueOnce(fetchResult.promise);
    act(() => void current.request(detail, action, null));
    const signal = vi.mocked(fetchCanonicalAdminAccessDetail).mock.calls[0]?.[1];

    act(() => root.unmount());
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      if (outcome === 'resolve') fetchResult.resolve({ ...detail, hasAdminAccess: true });
      else fetchResult.reject(new DOMException('Aborted', 'AbortError'));
    });

    expect(onChanged).not.toHaveBeenCalled();
    expect(runAdminAccessMutation).not.toHaveBeenCalled();
    root = createRoot(container);
    act(() => root.render(<Harness />));
    await open();
    expect(current.pending).toEqual({ action, detail, returnFocusTo: null });
  });

  it('ignores a late mutation completion after unmount', async () => {
    await open();
    const mutation = Promise.withResolvers<AdminAccessMutationOutcome>();
    vi.mocked(runAdminAccessMutation).mockReturnValueOnce(mutation.promise);
    act(() => void current.confirm());

    act(() => root.unmount());
    await act(async () => mutation.resolve({ kind: 'success', result: null }));

    expect(onChanged).not.toHaveBeenCalled();
    root = createRoot(container);
    act(() => root.render(<Harness />));
    expect(current.successMessage).toBeNull();
  });
});
