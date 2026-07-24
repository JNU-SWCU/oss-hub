import { AccountStatus, Role } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RolesErrorCode } from './roles-error-code.enum';
import type {
  AdminUserRecord,
  AdminUsersRepositoryPort,
  AdminUsersTransactionStore,
} from './admin-users.repository';
import { AdminUsersService } from './admin-users.service';

const ADMIN_GITHUB_ID = 9_131_000_001n;
const STAFF_GITHUB_ID = 9_131_000_002n;

function user(
  id: string,
  role: Role,
  githubId = STAFF_GITHUB_ID,
): AdminUserRecord {
  return {
    id,
    githubId,
    githubLogin: `synthetic-${role.toLowerCase()}`,
    name: '합성 사용자',
    role,
    accountStatus: AccountStatus.ACTIVE,
  };
}

class InMemoryAdminUsersRepository
  implements AdminUsersRepositoryPort, AdminUsersTransactionStore
{
  readonly auditLogWriter = {} as AuditLogTransactionWriter;
  readonly users = [
    user('synthetic-admin', Role.ADMIN, ADMIN_GITHUB_ID),
    user('synthetic-staff', Role.STAFF),
  ];

  withTransaction<T>(
    operation: (store: AdminUsersTransactionStore) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  findUserByGithubId(githubId: bigint): Promise<AdminUserRecord | null> {
    return Promise.resolve(
      this.users.find((candidate) => candidate.githubId === githubId) ?? null,
    );
  }

  findUserById(id: string): Promise<AdminUserRecord | null> {
    return Promise.resolve(
      this.users.find((candidate) => candidate.id === id) ?? null,
    );
  }

  list(): Promise<readonly AdminUserRecord[]> {
    return Promise.resolve(this.users);
  }

  async updateRole(id: string, role: Role): Promise<AdminUserRecord | null> {
    const target = await this.findUserById(id);
    if (!target) return null;
    const updated = { ...target, role };
    this.users.splice(this.users.indexOf(target), 1, updated);
    return updated;
  }
}

function auditLog(): { service: AuditLogService; record: jest.Mock } {
  const record = jest.fn().mockResolvedValue({});
  return {
    service: { record } as unknown as AuditLogService,
    record,
  };
}

describe('AdminUsersService', () => {
  it('활성 ADMIN만 이름·로그인 검색과 역할 필터 목록을 조회한다', async () => {
    const repository = new InMemoryAdminUsersRepository();
    const service = new AdminUsersService(repository, auditLog().service);

    await expect(
      service.list(ADMIN_GITHUB_ID, { query: '합성', role: Role.STAFF }),
    ).resolves.toEqual([
      expect.objectContaining({ id: 'synthetic-admin', isSelf: true }),
      expect.objectContaining({ id: 'synthetic-staff', isSelf: false }),
    ]);
    await expect(
      service.list(STAFF_GITHUB_ID, { query: '', role: undefined }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ADMIN_ONLY, status: 403 },
    });
  });

  it('역할을 변경하고 같은 트랜잭션 writer로 감사 로그를 정확히 한 번 기록한다', async () => {
    const repository = new InMemoryAdminUsersRepository();
    const audit = auditLog();
    const service = new AdminUsersService(repository, audit.service);

    const result = await service.updateRole(
      ADMIN_GITHUB_ID,
      'synthetic-staff',
      Role.ADMIN,
    );

    expect(result.role).toBe(Role.ADMIN);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      {
        actorGithubId: ADMIN_GITHUB_ID,
        action: 'USER_ROLE_CHANGED',
        targetType: 'USER',
        targetId: 'synthetic-staff',
      },
      repository.auditLogWriter,
    );
  });

  it('존재하지 않는 사용자 ID는 변경·감사 기록 없이 닫힌다', async () => {
    const audit = auditLog();
    const service = new AdminUsersService(
      new InMemoryAdminUsersRepository(),
      audit.service,
    );

    await expect(
      service.updateRole(ADMIN_GITHUB_ID, 'missing-user', Role.STUDENT),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.USER_NOT_FOUND, status: 404 },
    });
    expect(audit.record).not.toHaveBeenCalled();
  });
});
