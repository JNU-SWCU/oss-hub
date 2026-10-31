import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import { AccountStatus } from '@prisma/client';
import type { AuthConfig } from '../auth/auth.config';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { AccountDeactivationController } from './account-deactivation.controller';
import { AuthSessionService } from '../auth/auth-session.service';

const authSessionService = new AuthSessionService();

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
    const controller = new AccountDeactivationController(
      { deactivate },
      {
        useSecureCookies: true,
      } as AuthConfig,
      new AuthSessionService(),
    );

    await expect(
      controller.deactivate({ sessionGithubId: 42n }, {
        setHeader,
      } as unknown as Response),
    ).resolves.toEqual({ accountStatus: AccountStatus.DEACTIVATED });
    expect(deactivate).toHaveBeenCalledWith(42n);
    expect(setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      authSessionService.serializeClearedSessionCookie(true),
    );
  });
});
