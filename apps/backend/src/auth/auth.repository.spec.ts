import { AccountStatus, Role, User as PrismaUser } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { AuthConfig } from './auth.config';
import {
  AuthRepository,
  RoleRequestSeedConflictError,
} from './auth.repository';
import type { GithubProfile } from './domain/auth-user';
const REQUIRED_AUTH_ENV = {
  SESSION_SECRET: Buffer.from(
    'synthetic-auth-repository-session-secret',
  ).toString('base64url'),
  FRONTEND_URL: 'http://localhost:3000',
  GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
  GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
} as const;

function buildAuthConfig(overrides: NodeJS.ProcessEnv = {}): AuthConfig {
  return new AuthConfig(
    loadRuntimeConfig({ ...REQUIRED_AUTH_ENV, ...overrides }),
  );
}

function buildProfile(overrides: Partial<GithubProfile> = {}): GithubProfile {
  return {
    githubId: 424_242n,
    login: 'synthetic-login',
    name: null,
    avatarUrl: null,
    email: null,
    ...overrides,
  };
}

function buildRow(overrides: Partial<PrismaUser> = {}): PrismaUser {
  return {
    id: 'cuid-synthetic',
    githubId: 424_242n,
    nickname: 'synthetic-login',
    name: null,
    studentId: null,
    department: null,
    avatarUrl: null,
    accountStatus: AccountStatus.ACTIVE,
    role: null,
    notificationEmail: null,
    notifyEnabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildRepository(
  row: PrismaUser,
  initialRole: Role | null,
  options: {
    isNew?: boolean;
    casCount?: number;
    pendingRequest?: { id: string } | null;
    pendingTransitionCount?: number;
  } = {},
) {
  const createMany = jest
    .fn()
    .mockResolvedValue({ count: options.isNew ? 1 : 0 });
  const findUniqueOrThrow = jest.fn().mockResolvedValue(row);
  const update = jest.fn().mockResolvedValue(row);
  const updateMany = jest
    .fn()
    .mockResolvedValue({ count: options.casCount ?? 1 });
  const findFirst = jest.fn().mockResolvedValue(options.pendingRequest ?? null);
  const roleRequestUpdate = jest.fn().mockResolvedValue({});
  const roleRequestUpdateMany = jest.fn<
    Promise<{ count: number }>,
    [{ where: Record<string, unknown> }]
  >();
  roleRequestUpdateMany.mockResolvedValue({
    count: options.pendingTransitionCount ?? 1,
  });
  const roleRequestCreate = jest.fn<
    Promise<unknown>,
    [{ data: Record<string, unknown> }]
  >();
  roleRequestCreate.mockResolvedValue({});
  const transaction = {
    user: { createMany, findUniqueOrThrow, update, updateMany },
    roleRequest: {
      findFirst,
      update: roleRequestUpdate,
      updateMany: roleRequestUpdateMany,
      create: roleRequestCreate,
    },
  };
  const $transaction = jest
    .fn()
    .mockImplementation(
      (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );
  const prisma = { $transaction } as unknown as PrismaService;
  const config = {
    resolveInitialRole: jest.fn().mockReturnValue(initialRole),
  } as unknown as AuthConfig;
  return {
    repository: new AuthRepository(prisma, config),
    createMany,
    update,
    updateMany,
    findFirst,
    roleRequestUpdate,
    roleRequestUpdateMany,
    roleRequestCreate,
  };
}

function upsertUser(repository: AuthRepository, profile: GithubProfile) {
  return repository.withTransaction((store) => store.upsertUser(profile));
}

describe('AuthRepository.upsertUser', () => {
  it('미설정 시 부팅 가능한 빈 설정은 역할 시드를 적용하지 않는다', async () => {
    const config = buildAuthConfig();
    const { repository, updateMany } = buildRepository(buildRow(), null);

    expect(config.resolveInitialRole(424_242n)).toBeNull();
    const result = await upsertUser(repository, buildProfile());

    expect(result.user.role).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });
  it('환경에 설정된 초기 역할을 githubId로 조회한다', () => {
    const config = buildAuthConfig({
      AUTH_INITIAL_ROLES: '424242:STAFF',
    });

    expect(config.resolveInitialRole(424_242n)).toBe(Role.STAFF);
  });

  it('기존 role 보유자는 초기 역할 설정과 무관하게 유지한다', async () => {
    const { repository, updateMany } = buildRepository(
      buildRow({ role: Role.STUDENT }),
      Role.ADMIN,
    );

    const result = await upsertUser(repository, buildProfile());

    expect(result.user.role).toBe(Role.STUDENT);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('활성 role=null 계정만 조건부 갱신으로 초기 역할을 적용한다', async () => {
    const promoted = buildRow({ role: Role.ADMIN });
    const { repository, updateMany } = buildRepository(buildRow(), Role.ADMIN);
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
      },
      data: { role: Role.ADMIN },
    });
    expect(promoted.role).toBe(Role.ADMIN);
  });

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
    expect(update).toHaveBeenCalledWith({
      where: { githubId: 424_242n },
      data: { nickname: 'synthetic-login', avatarUrl: null },
    });
  });
});

describe('AuthRepository.findByGithubId', () => {
  it('DB role·accountStatus를 그대로 도메인 객체에 실어 반환한다', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValue(buildRow({ role: Role.STAFF }));
    const prisma = { user: { findUnique } } as unknown as PrismaService;
    const config = {} as AuthConfig;
    const repository = new AuthRepository(prisma, config);

    expect(await repository.findByGithubId(424_242n)).toMatchObject({
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
    });
  });
});
