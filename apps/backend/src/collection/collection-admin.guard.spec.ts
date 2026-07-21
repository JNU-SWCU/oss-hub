import { Role } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';

import { AuthConfig } from '../auth/auth.config';
import { SessionGuard } from '../auth/session.guard';
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

  it('ADMIN 사용자만 허용한다', async () => {
    findUnique.mockResolvedValue({ role: Role.ADMIN });
    const context = new ExecutionContextHost([{ sessionGithubId: 424242n }]);
    context.setType('http');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { githubId: 424242n },
      select: { role: true },
    });
  });

  it.each([Role.STUDENT, Role.STAFF, null])(
    'ADMIN이 아닌 역할 %s은 COL_004 403으로 거부한다',
    async (role) => {
      findUnique.mockResolvedValue({ role });
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
});

describe('Collection admin authentication', () => {
  it('세션이 없으면 AUT_003 401로 거부한다', async () => {
    const sessionGuard = new SessionGuard(new AuthConfig());
    const context = new ExecutionContextHost([{ headers: {} }]);
    context.setType('http');

    await expect(sessionGuard.canActivate(context)).rejects.toMatchObject({
      errorCode: { code: 'AUT_003', status: 401 },
    });
  });
});
