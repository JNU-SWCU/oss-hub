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
} from '../repository/admin-access.repository';
import type {
  AdminAccessFacets,
  AdminAccessListQuery,
  AdminAccessLoginHistoryPage,
  AdminAccessStaffAccessRequestHistoryPage,
} from '../domain/admin-access';
import type {
  IndependentAuthorityRepositoryPort,
  IndependentAuthorityTransactionStore,
} from '../repository/independent-authority.repository';

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

  insertRevokedRequest(
    input: Parameters<
      IndependentAuthorityTransactionStore['insertRevokedRequest']
    >[0],
  ): ReturnType<IndependentAuthorityTransactionStore['insertRevokedRequest']> {
    return this.store.insertRevokedRequest(input);
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
