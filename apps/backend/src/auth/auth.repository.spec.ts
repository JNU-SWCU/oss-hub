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

    expect(config.resolveInitialRole(424_242n)).toBe('STAFF');
  });

  it('기존 role 보유자는 초기 역할 설정과 무관하게 유지한다', async () => {
    const { repository, updateMany } = buildRepository(
      buildRow({ role: 'STUDENT' }),
      'ADMIN',
    );

    const result = await upsertUser(repository, buildProfile());

    expect(result.user.memberKind).toBe('STUDENT');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('활성 role=null 계정만 조건부 갱신으로 초기 역할을 적용한다', async () => {
    const promoted = buildRow({ role: 'ADMIN' });
    const { repository, updateMany } = buildRepository(buildRow(), 'ADMIN');
    const transactionResult = repository.withTransaction(async (store) => {
      const result = await store.upsertUser(buildProfile());
      return result;
    });
    await transactionResult;

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cuid-synthetic',
        accountStatus: AccountStatus.ACTIVE,
        role: null,
        staffAccessRequests: { none: { status: StaffAccessRequestStatus.REVOKED } },
      },
      data: {
        role: 'ADMIN',
        hasStaffAccess: false,
        hasAdminAccess: true,
      },
    });
    expect(promoted.role).toBe('ADMIN');
  });

  it('회수 이력이 있는 계정은 조건부 갱신에서 제외한다', async () => {
    // 회수는 role을 비우므로 회수된 사람도 `role: null` 조건을 만족한다.
    // 시드가 그를 다시 승격하지 못하게 막는 것은 이 관계 조건뿐이라,
    // 조건이 조용히 빠지면 회수가 로그인 한 번으로 되돌아간다.
    const { repository, updateMany } = buildRepository(buildRow(), 'STAFF');

    await upsertUser(repository, buildProfile());

    const promoteArgs = updateMany.mock.calls[0]?.[0];
    expect(promoteArgs?.where).toMatchObject({
      staffAccessRequests: { none: { status: StaffAccessRequestStatus.REVOKED } },
    });
  });

  it('회수된 계정이라 시드가 적용되지 않은 것은 경고가 아니라 debug로 남긴다', async () => {
    // 회수된 계정은 role이 영구히 null이라 로그인마다 이 경로에 들어온다.
    // 설계대로 막히는 정상 상태를 warn으로 올리면 로그가 그 한 사람으로 차서
    // 아래 CAS 경합 경고가 묻힌다.
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const { repository } = buildRepository(buildRow(), 'STAFF', {
      casCount: 0,
      revokedRequest: { id: 'revoked-request' },
    });

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
    const { repository } = buildRepository(buildRow(), 'STAFF', {
      casCount: 0,
    });

    await upsertUser(repository, buildProfile());

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('다른 트랜잭션이 먼저 역할을 정했다'),
    );
    expect(debug).not.toHaveBeenCalled();
    warn.mockRestore();
    debug.mockRestore();
  });
});
