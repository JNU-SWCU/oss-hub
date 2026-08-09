import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  deactivateMyAccount,
  AccountDeactivationResponseError,
} from './account-deactivation-api';

afterEach(() => vi.unstubAllGlobals());

describe('deactivateMyAccount', () => {
  it('uses the self-service endpoint and accepts only the deactivated state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accountStatus: 'DEACTIVATED' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(deactivateMyAccount()).resolves.toEqual({
      accountStatus: 'DEACTIVATED',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('users/me/account/deactivate'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('rejects a response that could leave the UI authenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ accountStatus: 'ACTIVE' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(deactivateMyAccount()).rejects.toBeInstanceOf(
      AccountDeactivationResponseError,
    );
  });
});
