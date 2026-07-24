import { AccountStatus, Role, User as PrismaUser } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthRepository } from './auth.repository';
import type { GithubProfile } from './domain/auth-user';

// 합성 데이터만 사용한다 (docs/rules/security.md)
function buildProfile(overrides: Partial<GithubProfile> = {}): GithubProfile {
  return {
    githubId: 424242n,
    login: 'synthetic-login',
    name: null,
    avatarUrl: null,
    ...overrides,
  };
}

function buildRow(overrides: Partial<PrismaUser> = {}): PrismaUser {
  return {
    id: 'cuid-synthetic',
    githubId: 424242n,
    nickname: 'synthetic-login',
    name: null,
    studentId: null,
    department: null,
    avatarUrl: null,
    accountStatus: AccountStatus.ACTIVE,
    role: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildRepository(
  row: PrismaUser,
  options: { isNew?: boolean; promotedRow?: PrismaUser } = {},
) {
  const createMany = jest
    .fn()
    .mockResolvedValue({ count: options.isNew ? 1 : 0 });
  const findUniqueOrThrow = jest.fn().mockResolvedValue(row);
  const update = jest
    .fn()
    .mockImplementation(({ data }: { data: object }) =>
      Promise.resolve(
        'role' in data && options.promotedRow ? options.promotedRow : row,
      ),
    );
  const transaction = { user: { createMany, findUniqueOrThrow, update } };
  const $transaction = jest
    .fn()
    .mockImplementation(
      (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );
  const prisma = { $transaction } as unknown as PrismaService;
  return {
    repository: new AuthRepository(prisma),
    createMany,
    findUniqueOrThrow,
    update,
  };
}

function upsertUser(repository: AuthRepository, profile: GithubProfile) {
  return repository.withTransaction((store) => store.upsertUser(profile));
}

describe('AuthRepository.upsertUser', () => {
  it('update 절은 role·accountStatus를 건드리지 않는다 — 로그인마다 권한 상태가 유지된다', async () => {
    const { repository, update } = buildRepository(
      buildRow({
        role: Role.STAFF,
        accountStatus: AccountStatus.DEACTIVATED,
      }),
    );

    const result = await upsertUser(repository, buildProfile());

    expect(result.user.role).toBe(Role.STAFF);
    expect(result.user.accountStatus).toBe(AccountStatus.DEACTIVATED);
    expect(result.isNew).toBe(false);
    const [updateArgs] = update.mock.calls[0] as [{ data: object }];
    expect(updateArgs.data).not.toHaveProperty('role');
    expect(updateArgs.data).not.toHaveProperty('accountStatus');
    expect(updateArgs.data).not.toHaveProperty('name');
  });

  it('비활성 부트스트랩 대상은 OAuth 재로그인만으로 ADMIN 승격·재활성화하지 않는다', async () => {
    const { repository, update } = buildRepository(
      buildRow({
        githubId: 1n,
        nickname: 'GoBeromsu',
        accountStatus: AccountStatus.DEACTIVATED,
        role: null,
      }),
    );

    const result = await upsertUser(
      repository,
      buildProfile({ githubId: 1n, login: 'GoBeromsu' }),
    );

    expect(result.user.accountStatus).toBe(AccountStatus.DEACTIVATED);
    expect(result.user.role).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('부트스트랩 대상 login의 신규 계정은 생성 시점에 ADMIN이 된다', async () => {
    const { repository, createMany, update } = buildRepository(
      buildRow({ githubId: 1n, nickname: 'GoBeromsu', role: Role.ADMIN }),
      { isNew: true },
    );

    const result = await upsertUser(
      repository,
      buildProfile({ githubId: 1n, login: 'GoBeromsu' }),
    );

    expect(result.user.role).toBe(Role.ADMIN);
    expect(result.isNew).toBe(true);
    const [createManyArgs] = createMany.mock.calls[0] as [
      { data: { role?: Role } },
    ];
    expect(createManyArgs.data.role).toBe(Role.ADMIN);
    expect(update).not.toHaveBeenCalled();
  });

  it('role이 아직 null인 기존 부트스트랩 대상 계정은 다음 로그인에 ADMIN으로 승격된다', async () => {
    const { repository, update } = buildRepository(
      buildRow({ githubId: 1n, nickname: 'GoBeromsu', role: null }),
      {
        promotedRow: buildRow({
          githubId: 1n,
          nickname: 'GoBeromsu',
          role: Role.ADMIN,
        }),
      },
    );

    const result = await upsertUser(
      repository,
      buildProfile({ githubId: 1n, login: 'GoBeromsu' }),
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 'cuid-synthetic' },
      data: { role: Role.ADMIN },
    });
    expect(result.user.role).toBe(Role.ADMIN);
  });

  it('부트스트랩 대상이 아닌 신규 로그인은 role이 null로 생성된다(기본값 없음)', async () => {
    const { repository, createMany, update } = buildRepository(
      buildRow({ role: null }),
      { isNew: true },
    );

    const result = await upsertUser(repository, buildProfile());

    expect(result.user.role).toBeNull();
    expect(result.isNew).toBe(true);
    const [createManyArgs] = createMany.mock.calls[0] as [
      { data: { role?: Role } },
    ];
    expect(createManyArgs.data.role).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it('활성 role=null 기존 계정은 OAuth 재로그인 뒤에도 온보딩 미완료 상태를 유지한다', async () => {
    const { repository, update } = buildRepository(
      buildRow({ role: null, accountStatus: AccountStatus.ACTIVE }),
    );

    const result = await upsertUser(repository, buildProfile());

    expect(result).toMatchObject({
      isNew: false,
      user: {
        role: null,
        accountStatus: AccountStatus.ACTIVE,
      },
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('기존 사용자의 온보딩 이름은 GitHub 재로그인으로 덮어쓰지 않는다', async () => {
    const { repository, update } = buildRepository(
      buildRow({ name: '사용자 입력 이름' }),
    );

    const result = await upsertUser(
      repository,
      buildProfile({ name: 'GitHub 표시 이름' }),
    );

    expect(result.user.name).toBe('사용자 입력 이름');
    expect(update).toHaveBeenCalledWith({
      where: { githubId: 424242n },
      data: { nickname: 'synthetic-login', avatarUrl: null },
    });
  });
});

describe('AuthRepository.findByGithubId', () => {
  it('DB role·accountStatus를 그대로 도메인 객체에 실어 반환한다', async () => {
    const findUnique = jest.fn().mockResolvedValue(
      buildRow({
        role: Role.STAFF,
        accountStatus: AccountStatus.DEACTIVATED,
      }),
    );
    const prisma = {
      user: { findUnique },
    } as unknown as PrismaService;
    const repository = new AuthRepository(prisma);

    const result = await repository.findByGithubId(424242n);

    expect(result).toMatchObject({
      role: Role.STAFF,
      accountStatus: AccountStatus.DEACTIVATED,
    });
  });

  it('존재하지 않는 계정은 null이다', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = {
      user: { findUnique },
    } as unknown as PrismaService;
    const repository = new AuthRepository(prisma);

    expect(await repository.findByGithubId(1n)).toBeNull();
  });
});
