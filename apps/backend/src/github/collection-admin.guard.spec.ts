import { AccountStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';

import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { SessionGuard } from '../auth/session.guard';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { CollectionAdminGuard } from './collection-admin.guard';
import { CollectionErrorCode } from './collection-error-code.enum';
import { PrismaService } from '../prisma/prisma.service';

describe('CollectionAdminGuard', () => {
  let testingModule: TestingModule;
  let guard: CollectionAdminGuard;
  const findUnique = jest.fn();

  beforeEach(async () => {
    testingModule = await Test.createTestingModule({
      providers: [
        CollectionAdminGuard,
        { provide: PrismaService, useValue: { user: { findUnique } } },
      ],
    }).compile();
    guard = testingModule.get(CollectionAdminGuard);
    findUnique.mockReset();
  });

  afterEach(async () => {
    await testingModule.close();
  });

  it('canonical hasAdminAccess 사용자를 허용한다', async () => {
    findUnique.mockResolvedValue({
      hasStaffAccess: false,
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    });
    const context = new ExecutionContextHost([{ sessionGithubId: 424242n }]);
    context.setType('http');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { githubId: 424242n },
      select: {
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
  });

  // 교직원 접근은 관리자 문을 열지 않는다 — 두 권한은 서로 독립이다.
  it('교직원 접근만으로는 거부한다', async () => {
    findUnique.mockResolvedValue({
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    const context = new ExecutionContextHost([{ sessionGithubId: 424242n }]);
    context.setType('http');

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      errorCode: { code: CollectionErrorCode.ADMIN_REQUIRED, status: 403 },
    });
  });

  it('관리자 접근이 없으면 COL_004 403으로 거부한다', async () => {
    {
      findUnique.mockResolvedValue({
        hasStaffAccess: false,
        hasAdminAccess: false,
        accountStatus: AccountStatus.ACTIVE,
      });
      const context = new ExecutionContextHost([{ sessionGithubId: 424242n }]);
      context.setType('http');

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        errorCode: {
          code: CollectionErrorCode.ADMIN_REQUIRED,
          status: 403,
        },
      });
    }
  });

  it('비활성 ADMIN도 COL_004 403으로 거부한다', async () => {
    findUnique.mockResolvedValue({
      hasStaffAccess: false,
      hasAdminAccess: true,
      accountStatus: AccountStatus.DEACTIVATED,
    });
    const context = new ExecutionContextHost([{ sessionGithubId: 424242n }]);
    context.setType('http');

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      errorCode: { code: CollectionErrorCode.ADMIN_REQUIRED, status: 403 },
    });
  });
});

describe('Collection admin authentication', () => {
  it('세션이 없으면 AUT_003 401로 거부한다', async () => {
    const sessionGuard = new SessionGuard(
      new AuthConfig(
        loadRuntimeConfig({
          SESSION_SECRET: Buffer.from(
            'synthetic-collection-admin-session-secret',
          ).toString('base64url'),
          FRONTEND_URL: 'http://localhost:3000',
          GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
          GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
        }),
      ),
      {
        getMe: jest.fn(),
      } as unknown as AuthService,
    );
    const context = new ExecutionContextHost([{ headers: {} }]);
    context.setType('http');

    await expect(sessionGuard.canActivate(context)).rejects.toMatchObject({
      errorCode: { code: 'AUT_003', status: 401 },
    });
  });
});
