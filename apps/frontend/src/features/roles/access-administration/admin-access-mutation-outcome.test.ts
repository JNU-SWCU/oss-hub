import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { AdminAccessMutationResponse } from './admin-access-api';
import { executeAdminAccessMutation } from './admin-access-mutation-execution';
import { runAdminAccessMutation } from './admin-access-mutation-outcome';
import { adminAccessMutationErrorMessage } from './admin-access-mutation-policy';
import type { CanonicalAdminAccessDetail } from './independent-authority-api';

vi.mock('./admin-access-mutation-execution', () => ({
  executeAdminAccessMutation: vi.fn(),
}));

const execute = vi.mocked(executeAdminAccessMutation);
const detail = { id: 'user-1' } as unknown as CanonicalAdminAccessDetail;

function problem(status: number, code: string, extra: object = {}) {
  return new ApiError({
    type: 'about:blank',
    title: 'problem',
    status,
    detail: `서버 문구 ${status}`,
    instance: '/x',
    code,
    ...extra,
  });
}

describe('runAdminAccessMutation', () => {
  beforeEach(() => execute.mockReset());

  it('returns success with the execution result', async () => {
    const result: AdminAccessMutationResponse = {
      id: 'user-1',
      role: 'STAFF',
      accountStatus: 'ACTIVE',
      pendingRequest: null,
      decidedRequest: null,
    };
    execute.mockResolvedValueOnce(result);
    await expect(
      runAdminAccessMutation({
        userId: 'user-1',
        action: 'APPROVE',
        detail,
        reason: '',
      }),
    ).resolves.toEqual({ kind: 'success', result });
    expect(execute).toHaveBeenCalledWith('user-1', 'APPROVE', detail, '');
  });

  it('classifies a member-kind 409 as conflict without projection', async () => {
    execute.mockRejectedValueOnce(problem(409, 'ANY'));
    await expect(
      runAdminAccessMutation({
        userId: 'user-1',
        action: 'SET_MEMBER_STAFF',
        detail,
        reason: '',
      }),
    ).resolves.toEqual({ kind: 'conflict', projection: null });
  });

  it('classifies a state-mismatch 409 as conflict with projection', async () => {
    const currentAccess = {
      id: 'user-1',
      role: 'STUDENT',
      accountStatus: 'ACTIVE',
      pendingRequest: null,
    };
    execute.mockRejectedValueOnce(problem(409, 'ROL_013', { currentAccess }));
    await expect(
      runAdminAccessMutation({
        userId: 'user-1',
        action: 'APPROVE',
        detail,
        reason: '',
      }),
    ).resolves.toEqual({ kind: 'conflict', projection: currentAccess });
  });

  it('classifies other failures as error with the display message', async () => {
    execute.mockRejectedValueOnce(problem(500, 'SRV'));
    await expect(
      runAdminAccessMutation({
        userId: 'user-1',
        action: 'APPROVE',
        detail,
        reason: '',
      }),
    ).resolves.toEqual({ kind: 'error', message: '서버 문구 500' });
    execute.mockRejectedValueOnce(new TypeError('network'));
    await expect(
      runAdminAccessMutation({
        userId: 'user-1',
        action: 'APPROVE',
        detail,
        reason: '',
      }),
    ).resolves.toEqual({
      kind: 'error',
      message: adminAccessMutationErrorMessage(new TypeError('network')),
    });
  });
});
