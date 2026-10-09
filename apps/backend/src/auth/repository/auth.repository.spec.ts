import { initialAccountSeed } from '../domain/initial-roles';
import { AccountStatus, StaffAccessRequestStatus } from '@prisma/client';
import { Logger } from '@nestjs/common';
import {
  buildAuthConfig,
  buildProfile,
  buildRepository,
  buildRow,
  upsertUser,
} from './auth.repository.spec-support';

describe('AuthRepository.upsertUser', () => {
  it('미설정 시 부팅 가능한 빈 설정은 역할 시드를 적용하지 않는다', async () => {
    const config = buildAuthConfig();
    const { repository, updateMany } = buildRepository(buildRow(), null);

    expect(config.resolveInitialRole(424_242n)).toBeNull();
    const result = await upsertUser(repository, buildProfile());

    expect(result.user.memberKind).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });
  it('환경에 설정된 초기 역할을 githubId로 조회한다', () => {
    const config = buildAuthConfig({
      AUTH_INITIAL_ROLES: '424242:STAFF',
    });

    expect(config.resolveInitialRole(424_242n)).toEqual({
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: false,
    });
  });

  it('이미 확정된 사실이 있는 계정은 초기 시드와 무관하게 유지한다', async () => {
    const { repository, updateMany } = buildRepository(
      buildRow({ hasStaffAccess: true }),
      initialAccountSeed('ADMIN'),
    );

    const result = await upsertUser(repository, buildProfile());

    expect(result.user.hasAdminAccess).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('확정된 사실이 없는 활성 계정만 조건부 갱신으로 초기 시드를 적용한다', async () => {
    const { repository, updateMany } = buildRepository(
      buildRow(),
      initialAccountSeed('ADMIN'),
    );
    const transactionResult = repository.withTransaction(async (store) => {
      const result = await store.upsertUser(buildProfile());
      return result;
    });
    await transactionResult;

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cuid-synthetic',
        accountStatus: AccountStatus.ACTIVE,
        hasStaffAccess: false,
        hasAdminAccess: false,
        profile: { is: null },
        staffAccessRequests: {
          none: { status: StaffAccessRequestStatus.REVOKED },
        },
      },
      data: {
        selectedMemberKind: null,
        hasStaffAccess: false,
        hasAdminAccess: true,
      },
    });
  });

  it('회수 이력이 있는 계정은 조건부 갱신에서 제외한다', async () => {
    const { repository, updateMany } = buildRepository(
      buildRow(),
      initialAccountSeed('STAFF'),
    );

    await upsertUser(repository, buildProfile());

    const promoteArgs = updateMany.mock.calls[0]?.[0];
    expect(promoteArgs?.where).toMatchObject({
      staffAccessRequests: {
        none: { status: StaffAccessRequestStatus.REVOKED },
      },
    });
  });

  it('회수된 계정이라 시드가 적용되지 않은 것은 경고가 아니라 debug로 남긴다', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const { repository } = buildRepository(
      buildRow(),
      initialAccountSeed('STAFF'),
      {
        casCount: 0,
        revokedRequest: { id: 'revoked-request' },
      },
    );

    await upsertUser(repository, buildProfile());

    expect(debug).toHaveBeenCalledWith(expect.stringContaining('회수된 계정'));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    debug.mockRestore();
  });

  it('회수 이력 없이 시드가 적용되지 않은 것은 CAS 경합이라 경고로 남긴다', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const { repository } = buildRepository(
      buildRow(),
      initialAccountSeed('STAFF'),
      {
        casCount: 0,
      },
    );

    await upsertUser(repository, buildProfile());

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('다른 트랜잭션이 먼저 결정했다'),
    );
    expect(debug).not.toHaveBeenCalled();
    warn.mockRestore();
    debug.mockRestore();
  });
});
