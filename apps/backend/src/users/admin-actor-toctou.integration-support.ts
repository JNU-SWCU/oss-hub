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
  AdminAccessStaffAccessRequestHistoryPage,
} from './domain/admin-access';

export type ActorReadPause = () => Promise<void>;

class PausingActorReadAccessStore implements AdminAccessTransactionStore {
  constructor(
    private readonly store: AdminAccessTransactionStore,
    private readonly onActorRead: ActorReadPause,
  ) {}

  get auditLogWriter() {
    return this.store.auditLogWriter;
  }

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
