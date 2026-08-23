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
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    const context = new ExecutionContextHost([{ sessionGithubId: 424242n }]);
    context.setType('http');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { githubId: 424242n },
      select: {
        role: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
  });

  it('canonical 컬럼이 비어 있으면 legacy ADMIN 역할로 허용한다', async () => {
    findUnique.mockResolvedValue({
      hasStaffAccess: false,
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    });
    const context = new ExecutionContextHost([{ sessionGithubId: 424242n }]);
    context.setType('http');

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('legacy 역할이 ADMIN이어도 canonical hasAdminAccess=false면 거부한다', async () => {
    findUnique.mockResolvedValue({
      hasStaffAccess: false,
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    });
    const context = new ExecutionContextHost([{ sessionGithubId: 424242n }]);
    context.setType('http');

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      errorCode: { code: CollectionErrorCode.ADMIN_REQUIRED, status: 403 },
    });
  });

  it.each(['STUDENT', 'STAFF', null])(
    'ADMIN이 아닌 역할 %s은 COL_004 403으로 거부한다',
    async (role) => {
      findUnique.mockResolvedValue({
        role,
        hasStaffAccess: null,
        hasAdminAccess: null,
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
    },
  );

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
