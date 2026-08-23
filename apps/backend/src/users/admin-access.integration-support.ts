import type {
  AdminAccessActor,
  AdminAccessInsertedRequest,
  AdminAccessRepositoryPort,
  AdminAccessRevokedRequestInsert,
  AdminAccessTransactionStore,
  AdminAccessUserDetailRecord,
  AdminAccessUserPageRecord,
  AdminAccessUserRecord,
  AdminAccessUserUpdate,
  AdminAccessPendingDecisionUpdate,
} from './admin-access.repository';
import type {
  AdminAccessFacets,
  AdminAccessListQuery,
  AdminAccessLoginHistoryPage,
  AdminAccessStaffAccessRequestHistoryPage,
} from './domain/admin-access';
import type {
  IndependentAuthorityRepositoryPort,
  IndependentAuthorityTransactionStore,
} from './independent-authority.repository';

class TwoPartyBarrier {
  private arrivals = 0;
  private release: (() => void) | null = null;
  private readonly released = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  async wait(): Promise<void> {
    this.arrivals += 1;
    if (this.arrivals === 2) {
      this.release?.();
    }
    await this.released;
  }
}

class BarrierTransactionStore implements AdminAccessTransactionStore {
  constructor(
    private readonly store: AdminAccessTransactionStore,
    private readonly barrier: TwoPartyBarrier,
  ) {}

  get auditLogWriter() {
    return this.store.auditLogWriter;
  }

  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null> {
    return this.store.findActorByGithubId(githubId);
  }

  /**
   * 두 트랜잭션이 **잠금을 잡기 전에** 나란히 열려 있도록 만나게 한다.
   *
   * 배리어가 이보다 뒤에 있으면 안 된다 — `lockActiveAdmins`는 활성 ADMIN 행을 전부
   * 잠그므로, 먼저 도착한 쪽이 잠금을 쥔 채 배리어에서 기다리면 다른 쪽은 그 잠금에
   * 막혀 배리어에 영영 도착하지 못한다(교착).
   */
  async lockActiveAdmins(): Promise<number> {
    await this.barrier.wait();
    return this.store.lockActiveAdmins();
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

export class BarrierAdminAccessRepository implements AdminAccessRepositoryPort {
  private readonly barrier = new TwoPartyBarrier();

  constructor(private readonly repository: AdminAccessRepositoryPort) {}

  withTransaction<T>(
    operation: (store: AdminAccessTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.repository.withTransaction((store) =>
      operation(new BarrierTransactionStore(store, this.barrier)),
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

  listStaffAccessRequestHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessStaffAccessRequestHistoryPage> {
    return this.repository.listStaffAccessRequestHistory(userId, page);
  }

  listLoginHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessLoginHistoryPage> {
    return this.repository.listLoginHistory(userId, page);
  }
}

/**
 * 회수 트랜잭션을 **두 쓰기를 마친 뒤 커밋 직전**에 멈춰 세운다.
 *
 * 그 자리가 회수의 유일한 위험 구간이다 — `User.role`은 비었고 `REVOKED` 행도 들어갔지만
 * 아직 아무도 그 사실을 볼 수 없는 순간이라, 이때 로그인이 끼어들면 어떻게 되는지가
 * 실제로 확인해야 하는 것이다. 그래서 stub이 아니라 실 DB 잠금 위에서 멈춘다.
 */
class RevocationPauseTransactionStore implements AdminAccessTransactionStore {
  constructor(
    private readonly store: AdminAccessTransactionStore,
    private readonly onRevokedRequestWritten: () => Promise<void>,
  ) {}

  get auditLogWriter() {
    return this.store.auditLogWriter;
  }

  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null> {
    return this.store.findActorByGithubId(githubId);
  }

  lockActiveAdmins(): Promise<number> {
    return this.store.lockActiveAdmins();
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

  async insertRevokedRequest(
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest> {
    const inserted = await this.store.insertRevokedRequest(input);
    await this.onRevokedRequestWritten();
    return inserted;
  }
}

export class PausingRevocationAdminAccessRepository implements AdminAccessRepositoryPort {
  constructor(
    private readonly repository: AdminAccessRepositoryPort,
    private readonly onRevokedRequestWritten: () => Promise<void>,
  ) {}

  withTransaction<T>(
    operation: (store: AdminAccessTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.repository.withTransaction((store) =>
      operation(
        new RevocationPauseTransactionStore(
          store,
          this.onRevokedRequestWritten,
        ),
      ),
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

  listStaffAccessRequestHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessStaffAccessRequestHistoryPage> {
    return this.repository.listStaffAccessRequestHistory(userId, page);
  }

  listLoginHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessLoginHistoryPage> {
    return this.repository.listLoginHistory(userId, page);
  }
}

/**
 * TOCTOU 재검증 경쟁을 재현하기 위해 뮤테이션 트랜잭션을 두 지점에서 멈춰 세운다.
 *
 * `onFirstActorRead`는 잠금 이전의 unlocked 첫 actor 읽기 "직후"에, `onAfterLock`은
 * `lockActiveAdmins()` "직후"에 걸린다 — 재검증(두 번째 actor 읽기)은 절대 멈추지 않는다.
 * 두 훅이 각각 가리키는 것은 재검증이 막아야 하는 경쟁의 시작 지점과, 잠금이 실제로
 * 걸린 뒤의 경쟁이다.
 */
class PausingActorRevalidationTransactionStore implements AdminAccessTransactionStore {
  private actorReadCount = 0;

  constructor(
    private readonly store: AdminAccessTransactionStore,
    private readonly hooks: {
      readonly onFirstActorRead?: () => Promise<void>;
      readonly onAfterLock?: () => Promise<void>;
    },
  ) {}

  get auditLogWriter() {
    return this.store.auditLogWriter;
  }

  async findActorByGithubId(
    githubId: bigint,
  ): Promise<AdminAccessActor | null> {
    const actor = await this.store.findActorByGithubId(githubId);
    this.actorReadCount += 1;
    if (this.actorReadCount === 1 && this.hooks.onFirstActorRead) {
      await this.hooks.onFirstActorRead();
    }
    return actor;
  }

  async lockActiveAdmins(): Promise<number> {
    const count = await this.store.lockActiveAdmins();
    if (this.hooks.onAfterLock) {
      await this.hooks.onAfterLock();
    }
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

export class PausingActorRevalidationAdminAccessRepository implements AdminAccessRepositoryPort {
  constructor(
    private readonly repository: AdminAccessRepositoryPort,
    private readonly hooks: {
      readonly onFirstActorRead?: () => Promise<void>;
      readonly onAfterLock?: () => Promise<void>;
    },
  ) {}

  withTransaction<T>(
    operation: (store: AdminAccessTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.repository.withTransaction((store) =>
      operation(
        new PausingActorRevalidationTransactionStore(store, this.hooks),
      ),
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

  listStaffAccessRequestHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessStaffAccessRequestHistoryPage> {
    return this.repository.listStaffAccessRequestHistory(userId, page);
  }

  listLoginHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessLoginHistoryPage> {
    return this.repository.listLoginHistory(userId, page);
  }
}

class DecisionFailureTransactionStore implements AdminAccessTransactionStore {
  constructor(private readonly store: AdminAccessTransactionStore) {}

  get auditLogWriter() {
    return this.store.auditLogWriter;
  }

  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null> {
    return this.store.findActorByGithubId(githubId);
  }

  lockActiveAdmins(): Promise<number> {
    return this.store.lockActiveAdmins();
  }

  findUserForUpdate(userId: string): Promise<AdminAccessUserRecord | null> {
    return this.store.findUserForUpdate(userId);
  }

  compareAndSwapAccess(input: AdminAccessUserUpdate): Promise<boolean> {
    return this.store.compareAndSwapAccess(input);
  }

  decidePendingRequest(): Promise<boolean> {
    return Promise.resolve(false);
  }

  insertRevokedRequest(
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest> {
    return this.store.insertRevokedRequest(input);
  }
}

export class FailingDecisionAdminAccessRepository implements AdminAccessRepositoryPort {
  constructor(private readonly repository: AdminAccessRepositoryPort) {}

  withTransaction<T>(
    operation: (store: AdminAccessTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.repository.withTransaction((store) =>
      operation(new DecisionFailureTransactionStore(store)),
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

  listStaffAccessRequestHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessStaffAccessRequestHistoryPage> {
    return this.repository.listStaffAccessRequestHistory(userId, page);
  }

  listLoginHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessLoginHistoryPage> {
    return this.repository.listLoginHistory(userId, page);
  }
}

class BarrierIndependentAuthorityStore implements IndependentAuthorityTransactionStore {
  constructor(
    private readonly store: IndependentAuthorityTransactionStore,
    private readonly barrier: TwoPartyBarrier,
  ) {}

  get auditLogWriter() {
    return this.store.auditLogWriter;
  }

  findActorByGithubId(githubId: bigint) {
    return this.store.findActorByGithubId(githubId);
  }

  async lockActiveAdmins(): Promise<number> {
    await this.barrier.wait();
    return this.store.lockActiveAdmins();
  }

  findUserForUpdate(userId: string) {
    return this.store.findUserForUpdate(userId);
  }

  updateAuthority(
    userId: string,
    transition: Parameters<
      IndependentAuthorityTransactionStore['updateAuthority']
    >[1],
  ): Promise<void> {
    return this.store.updateAuthority(userId, transition);
  }
}

export class BarrierIndependentAuthorityRepository implements IndependentAuthorityRepositoryPort {
  private readonly barrier = new TwoPartyBarrier();

  constructor(
    private readonly repository: IndependentAuthorityRepositoryPort,
  ) {}

  withTransaction<T>(
    operation: (store: IndependentAuthorityTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.repository.withTransaction((store) =>
      operation(new BarrierIndependentAuthorityStore(store, this.barrier)),
    );
  }
}
