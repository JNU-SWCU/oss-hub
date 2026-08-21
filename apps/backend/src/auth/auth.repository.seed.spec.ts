import { Role } from '@prisma/client';
import { RoleRequestSeedConflictError } from './auth.repository';
import {
  buildProfile,
  buildRepository,
  buildRow,
  upsertUser,
} from './auth.repository.spec-support';

describe('AuthRepository.upsertUser seed requests', () => {
  it('CAS 경쟁에서 갱신하지 못하면 역할 요청 부수효과도 만들지 않는다', async () => {
    const { repository, roleRequestCreate, roleRequestUpdate } =
      buildRepository(buildRow(), Role.STAFF, { casCount: 0 });

    await upsertUser(repository, buildProfile());

    expect(roleRequestCreate).not.toHaveBeenCalled();
    expect(roleRequestUpdate).not.toHaveBeenCalled();
  });

  it('STAFF 시드는 PENDING 역할 요청을 status CAS로 APPROVED에 전이한다', async () => {
    const { repository, roleRequestCreate, roleRequestUpdateMany } =
      buildRepository(buildRow(), Role.STAFF, {
        pendingRequest: { id: 'pending-request' },
      });

    await upsertUser(repository, buildProfile());

    expect(roleRequestUpdateMany).toHaveBeenCalledTimes(1);
    const transitionArgs = roleRequestUpdateMany.mock.calls[0]?.[0] as
      { where?: Record<string, unknown> } | undefined;
    expect(transitionArgs?.where).toEqual({
      id: 'pending-request',
      status: 'PENDING',
    });
    expect(roleRequestCreate).not.toHaveBeenCalled();
  });

  it('전이 직전 관리자가 같은 신청을 결정했으면 시드 트랜잭션이 실패한다', async () => {
    const { repository, roleRequestCreate } = buildRepository(
      buildRow(),
      Role.STAFF,
      { pendingRequest: { id: 'pending-request' }, pendingTransitionCount: 0 },
    );

    await expect(upsertUser(repository, buildProfile())).rejects.toThrow(
      RoleRequestSeedConflictError,
    );
    expect(roleRequestCreate).not.toHaveBeenCalled();
  });

  it('STAFF 시드는 PENDING 요청이 없을 때만 APPROVED 요청을 만든다', async () => {
    const { repository, roleRequestCreate } = buildRepository(
      buildRow(),
      Role.STAFF,
    );

    await upsertUser(repository, buildProfile());

    expect(roleRequestCreate).toHaveBeenCalledTimes(1);
    const createArgs = roleRequestCreate.mock.calls[0]?.[0];
    expect(createArgs?.data).toMatchObject({
      userId: 'cuid-synthetic',
      status: 'APPROVED',
      decidedById: null,
    });
  });

  it('기존 사용자의 온보딩 이름은 GitHub 재로그인으로 덮어쓰지 않는다', async () => {
    const { repository, update } = buildRepository(
      buildRow({ name: '사용자 입력 이름' }),
      null,
    );

    const result = await upsertUser(
      repository,
      buildProfile({ name: 'GitHub 표시 이름' }),
    );

    expect(result.user.name).toBe('사용자 입력 이름');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { githubId: 424_242n },
        data: { nickname: 'synthetic-login', avatarUrl: null },
      }),
    );
  });
});
