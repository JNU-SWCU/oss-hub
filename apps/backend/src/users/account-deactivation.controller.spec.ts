import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import { AccountStatus } from '@prisma/client';
import type { AuthConfig } from '../auth/auth.config';
import { serializeClearedSessionCookie } from '../auth/cookies';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { AccountDeactivationController } from './account-deactivation.controller';

describe('AccountDeactivationController', () => {
  it('requires a live session and same-origin mutation', () => {
    const deactivateMethod: unknown = Object.getOwnPropertyDescriptor(
      AccountDeactivationController.prototype,
      'deactivate',
    )?.value;
    if (typeof deactivateMethod !== 'function') {
      throw new TypeError('deactivate controller method is missing');
    }
    expect(Reflect.getMetadata(GUARDS_METADATA, deactivateMethod)).toEqual([
      SessionGuard,
      OriginGuard,
    ]);
  });

  it('clears the session cookie only after deactivation succeeds', async () => {
    const deactivate = jest.fn().mockResolvedValue({
      accountStatus: AccountStatus.DEACTIVATED,
    });
    const setHeader = jest.fn();
    const controller = new AccountDeactivationController({ deactivate }, {
      useSecureCookies: true,
    } as AuthConfig);

    await expect(
      controller.deactivate({ sessionGithubId: 42n }, {
        setHeader,
      } as unknown as Response),
    ).resolves.toEqual({ accountStatus: AccountStatus.DEACTIVATED });
    expect(deactivate).toHaveBeenCalledWith(42n);
    expect(setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      serializeClearedSessionCookie(true),
    );
  });
});
