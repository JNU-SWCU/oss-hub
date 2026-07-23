import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { SessionGuard } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import { AdminUsersController } from './admin-users.controller';
import { PatchUserRoleRequestDto } from './dto/patch-user-role.dto';
import type { AdminUsersService } from './admin-users.service';
import { RolesErrorCode } from './roles-error-code.enum';

const REQUEST: Pick<AuthenticatedRequest, 'sessionGithubId'> = {
  sessionGithubId: 9_131_000_001n,
};

function guards(methodName: 'list' | 'updateRole'): unknown[] {
  const method: unknown = Object.getOwnPropertyDescriptor(
    AdminUsersController.prototype,
    methodName,
  )?.value;
  const metadata: unknown =
    typeof method === 'function'
      ? Reflect.getMetadata(GUARDS_METADATA, method)
      : undefined;
  return Array.isArray(metadata) ? (metadata as unknown[]) : [];
}

describe('AdminUsersController', () => {
  it('목록은 세션 guard, 변경은 세션과 Origin guard를 적용한다', () => {
    expect(guards('list')).toEqual([SessionGuard]);
    expect(guards('updateRole')).toEqual([SessionGuard, OriginGuard]);
  });

  it('지원하지 않는 역할 값과 잘못된 사용자 ID를 fail closed 처리한다', async () => {
    const service: Pick<AdminUsersService, 'list' | 'updateRole'> = {
      list: jest.fn(),
      updateRole: jest.fn(),
    };
    const controller = new AdminUsersController(service);
    const invalidRole = Object.assign(new PatchUserRoleRequestDto(), {
      role: 'OWNER',
    });

    expect(() => invalidRole.toRole()).toThrow(DomainException);
    await expect(
      controller.updateRole(REQUEST, 'invalid id', invalidRole),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.INVALID_USER_ID, status: 400 },
    });
    expect(service.updateRole).not.toHaveBeenCalled();
  });

  it('검증된 역할 변경을 서비스에 전달한다', async () => {
    const updateRole = jest.fn().mockResolvedValue({
      id: 'c123456789012345678901234',
      githubLogin: 'synthetic-user',
      name: '합성 사용자',
      role: Role.ADMIN,
      accountStatus: 'ACTIVE',
      isSelf: false,
    });
    const service: Pick<AdminUsersService, 'list' | 'updateRole'> = {
      list: jest.fn(),
      updateRole,
    };
    const controller = new AdminUsersController(service);
    const body = Object.assign(new PatchUserRoleRequestDto(), {
      role: Role.ADMIN,
    });

    await controller.updateRole(REQUEST, 'c123456789012345678901234', body);

    expect(updateRole).toHaveBeenCalledWith(
      REQUEST.sessionGithubId,
      'c123456789012345678901234',
      Role.ADMIN,
    );
  });
});
