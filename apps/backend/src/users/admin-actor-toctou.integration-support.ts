import type {
  AdminAccessActor,
  AdminAccessInsertedRequest,
  AdminAccessPendingDecisionUpdate,
  AdminAccessRepositoryPort,
  AdminAccessRevokedRequestInsert,
  AdminAccessTransactionStore,
  AdminAccessUserDetailRecord,
  AdminAccessUserPageRecord,
  AdminAccessUserRecord,
  AdminAccessUserUpdate,
} from './admin-access.repository';
import type {
  AdminProfileApplyOutcome,
  AdminProfileLegacyFields,
  AdminProfileRepositoryPort,
  AdminProfileTargetRecord,
  AdminProfileTransactionStore,
  AdminProfileWriteFields,
} from './admin-profile.repository.types';
import type {
  AdminAccessFacets,
  AdminAccessListQuery,
  AdminAccessLoginHistoryPage,
  AdminAccessRoleRequestHistoryPage,
} from './domain/admin-access';

/**
 * actor를 읽은 **직후**에 트랜잭션을 멈춰 세우는 대역들(#687).
 *
 * 그 지점이 이 이슈의 전부다. 권한 판정이 끝난 순간부터 커밋까지 actor 행이 정말로
 * 고정돼 있는지는 실 DB 잠금 위에서만 확인할 수 있다 — 멈춰 세운 상태에서 바깥의 강등이
 * 실제로 **막히는지**를 `pg_blocking_pids`로 지목해 물어보기 위한 장치다.
 */
export type ActorReadPause = () => Promise<void>;

class PausingActorReadAccessStore implements AdminAccessTransactionStore {
  constructor(
    private readonly store: AdminAccessTransactionStore,
    private readonly onActorRead: ActorReadPause,
  ) {}

  get auditLogWriter() {
    return this.store.auditLogWriter;
  }

  /**
   * 잠금 **뒤** actor 읽기에서만 멈춘다.
   *
   * 이 경로에는 actor 읽기가 두 번 있다 — 잠금 이전의 빠른 거부용 읽기와 잠금 뒤
   * 재검증용 읽기(#800). 앞쪽에서 멈추면 아직 아무 행도 잠겨 있지 않아 바깥 강등이
   * 막히지 않고, 그러면 이 스펙은 자기가 주장하는 "판정 뒤에는 actor 행이 고정돼
   * 있다"가 아니라 아무것도 증명하지 못한 채 실패한다.
   */
  private locked = false;

  async findActorByGithubId(
    githubId: bigint,
  ): Promise<AdminAccessActor | null> {
    const actor = await this.store.findActorByGithubId(githubId);
    if (this.locked) {
      await this.onActorRead();
    }
    return actor;
  }

  async lockActiveAdmins(): Promise<number> {
    const count = await this.store.lockActiveAdmins();
    this.locked = true;
    return count;
  }

  findUserForUpdate(userId: string): Promise<AdminAccessUserRecord | null> {
    return this.store.findUserForUpdate(userId);
  }

  compareAndSwapAccess(input: AdminAccessUserUpdate): Promise<boolean> {
    return this.store.compareAndSwapAccess(input);
  }

  decidePendingRequest(
    input: AdminAccessPendingDecisionUpdate,
  ): Promise<boolean> {
    return this.store.decidePendingRequest(input);
  }

  insertRevokedRequest(
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest> {
    return this.store.insertRevokedRequest(input);
  }
}

export class PausingActorReadAdminAccessRepository implements AdminAccessRepositoryPort {
  constructor(
    private readonly repository: AdminAccessRepositoryPort,
    private readonly onActorRead: ActorReadPause,
  ) {}

  withTransaction<T>(
    operation: (store: AdminAccessTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.repository.withTransaction((store) =>
      operation(new PausingActorReadAccessStore(store, this.onActorRead)),
    );
  }

  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null> {
    return this.repository.findActorByGithubId(githubId);
  }

  list(query: AdminAccessListQuery): Promise<AdminAccessUserPageRecord> {
    return this.repository.list(query);
  }

  facets(query: AdminAccessListQuery): Promise<AdminAccessFacets> {
    return this.repository.facets(query);
  }

  findById(userId: string): Promise<AdminAccessUserDetailRecord | null> {
    return this.repository.findById(userId);
  }

  listRoleRequestHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessRoleRequestHistoryPage> {
    return this.repository.listRoleRequestHistory(userId, page);
  }

  listLoginHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessLoginHistoryPage> {
    return this.repository.listLoginHistory(userId, page);
  }
}

class PausingActorReadProfileStore implements AdminProfileTransactionStore {
  constructor(
    private readonly store: AdminProfileTransactionStore,
    private readonly onActorRead: ActorReadPause,
  ) {}

  get auditLogWriter() {
    return this.store.auditLogWriter;
  }

  lockActiveAdmins(): Promise<void> {
    return this.store.lockActiveAdmins();
  }

  async findActor(githubId: bigint): Promise<AdminAccessActor | null> {
    const actor = await this.store.findActor(githubId);
    await this.onActorRead();
    return actor;
  }

  findTarget(userId: string): Promise<AdminProfileTargetRecord | null> {
    return this.store.findTarget(userId);
  }

  applyProfile(
    userId: string,
    fields: AdminProfileWriteFields,
    changedFields: Partial<AdminProfileWriteFields>,
  ): Promise<AdminProfileApplyOutcome> {
    return this.store.applyProfile(userId, fields, changedFields);
  }

  applyLegacyFields(
    userId: string,
    fields: AdminProfileLegacyFields,
  ): Promise<void> {
    return this.store.applyLegacyFields(userId, fields);
  }
}

export class PausingActorReadAdminProfileRepository implements AdminProfileRepositoryPort {
  constructor(
    private readonly repository: AdminProfileRepositoryPort,
    private readonly onActorRead: ActorReadPause,
  ) {}

  withTransaction<T>(
    operation: (store: AdminProfileTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.repository.withTransaction((store) =>
      operation(new PausingActorReadProfileStore(store, this.onActorRead)),
    );
  }
}
