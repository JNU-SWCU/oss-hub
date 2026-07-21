import { AccountStatus, Role, User as PrismaUser } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthRepository } from './auth.repository';
import { GithubProfile } from './domain/auth-user';

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
    login: 'synthetic-login',
    name: null,
    avatarUrl: null,
    accountStatus: AccountStatus.ACTIVE,
    role: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildRepository(row: PrismaUser, updatedRow?: PrismaUser) {
  const upsert = jest.fn().mockResolvedValue(row);
  const update = jest.fn().mockResolvedValue(updatedRow ?? row);
  const prisma = { user: { upsert, update } } as unknown as PrismaService;
  return { repository: new AuthRepository(prisma), upsert, update };
}

describe('AuthRepository.upsertUser', () => {
  it('update 절은 role·accountStatus를 건드리지 않는다 — 로그인마다 권한 상태가 유지된다', async () => {
    const { repository, upsert, update } = buildRepository(
      buildRow({
        role: Role.STAFF,
        accountStatus: AccountStatus.DEACTIVATED,
      }),
    );

    const result = await repository.upsertUser(buildProfile());

    expect(result.role).toBe(Role.STAFF);
    expect(result.accountStatus).toBe(AccountStatus.DEACTIVATED);
    const [upsertArgs] = upsert.mock.calls[0] as [{ update: object }];
    expect(upsertArgs.update).not.toHaveProperty('role');
    expect(upsertArgs.update).not.toHaveProperty('accountStatus');
    expect(update).not.toHaveBeenCalled();
  });

  it('비활성 부트스트랩 대상은 OAuth 재로그인만으로 ADMIN 승격·재활성화하지 않는다', async () => {
    const { repository, update } = buildRepository(
      buildRow({
        githubId: 1n,
        login: 'GoBeromsu',
        accountStatus: AccountStatus.DEACTIVATED,
        role: null,
      }),
    );

    const result = await repository.upsertUser(
      buildProfile({ githubId: 1n, login: 'GoBeromsu' }),
    );

    expect(result.accountStatus).toBe(AccountStatus.DEACTIVATED);
    expect(result.role).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('부트스트랩 대상 login의 신규 계정은 생성 시점에 ADMIN이 된다', async () => {
    const { repository, upsert, update } = buildRepository(
      buildRow({ githubId: 1n, login: 'GoBeromsu', role: Role.ADMIN }),
    );

    const result = await repository.upsertUser(
      buildProfile({ githubId: 1n, login: 'GoBeromsu' }),
    );

    expect(result.role).toBe(Role.ADMIN);
    const [upsertArgs] = upsert.mock.calls[0] as [{ create: { role?: Role } }];
    expect(upsertArgs.create.role).toBe(Role.ADMIN);
    expect(update).not.toHaveBeenCalled();
  });

  it('role이 아직 null인 기존 부트스트랩 대상 계정은 다음 로그인에 ADMIN으로 승격된다', async () => {
    const { repository, update } = buildRepository(
      buildRow({ githubId: 1n, login: 'GoBeromsu', role: null }),
      buildRow({ githubId: 1n, login: 'GoBeromsu', role: Role.ADMIN }),
    );

    const result = await repository.upsertUser(
      buildProfile({ githubId: 1n, login: 'GoBeromsu' }),
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 'cuid-synthetic' },
      data: { role: Role.ADMIN },
    });
    expect(result.role).toBe(Role.ADMIN);
  });

  it('부트스트랩 대상이 아닌 신규 로그인은 role이 null로 생성된다(기본값 없음)', async () => {
    const { repository, upsert, update } = buildRepository(
      buildRow({ role: null }),
    );

    const result = await repository.upsertUser(buildProfile());

    expect(result.role).toBeNull();
    const [upsertArgs] = upsert.mock.calls[0] as [{ create: { role?: Role } }];
    expect(upsertArgs.create.role).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it('활성 role=null 기존 계정은 OAuth 재로그인 뒤에도 온보딩 미완료 상태를 유지한다', async () => {
    const { repository, update } = buildRepository(
      buildRow({ role: null, accountStatus: AccountStatus.ACTIVE }),
    );

    const result = await repository.upsertUser(buildProfile());

    expect(result).toMatchObject({
      role: null,
      accountStatus: AccountStatus.ACTIVE,
    });
    expect(update).not.toHaveBeenCalled();
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
