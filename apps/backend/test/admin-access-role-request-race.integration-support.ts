import type {
  StaffRoleRequestListQuery,
  StaffRoleReactivationApproval,
  StaffRoleRequestRecord,
  StaffRoleRequestTransition,
  StaffUserAccountStatusTransition,
  StaffUserRoleTransition,
} from '../src/roles/domain/staff-role-request';
import type {
  StaffRoleRequestActor,
  StaffRoleRequestsRepositoryPort,
  StaffRoleRequestsTransactionStore,
} from '../src/roles/staff-role-requests.repository';
import type {
  AdminAccessActor,
  AdminAccessPendingDecisionUpdate,
  AdminAccessRepositoryPort,
  AdminAccessTransactionStore,
  AdminAccessUserDetailRecord,
  AdminAccessUserPageRecord,
  AdminAccessUserRecord,
  AdminAccessUserUpdate,
} from '../src/users/admin-access.repository';
import type {
  AdminAccessFacets,
  AdminAccessListQuery,
  AdminAccessLoginHistoryPage,
  AdminAccessRoleRequestHistoryPage,
} from '../src/users/domain/admin-access';

class Signal {
  private release: (() => void) | null = null;
  private readonly ready = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  wait(): Promise<void> {
    return this.ready;
  }

  open(): void {
    this.release?.();
  }
}

export class RoleRequestRaceGate {
  readonly staffRequestTransitioned = new Signal();
  readonly unifiedAdminLockRequested = new Signal();
  readonly allowStaffCommit = new Signal();
}

class PausedStaffRoleRequestsTransactionStore implements StaffRoleRequestsTransactionStore {
  constructor(
    private readonly store: StaffRoleRequestsTransactionStore,
    private readonly gate: RoleRequestRaceGate,
  ) {}

  get auditLogWriter() {
    return this.store.auditLogWriter;
  }

  findUserByGithubId(githubId: bigint): Promise<StaffRoleRequestActor | null> {
    return this.store.findUserByGithubId(githubId);
  }

  findUserProfileById(userId: string) {
    return this.store.findUserProfileById(userId);
  }

  findRequestById(requestId: string): Promise<StaffRoleRequestRecord | null> {
    return this.store.findRequestById(requestId);
  }

  lockActiveAdmins(): Promise<void> {
    return this.store.lockActiveAdmins();
  }

  lockUserForUpdate(userId: string): Promise<void> {
    return this.store.lockUserForUpdate(userId);
  }

  lockRequestById(requestId: string): Promise<StaffRoleRequestRecord | null> {
    return this.store.lockRequestById(requestId);
  }

  async transitionRequest(input: StaffRoleRequestTransition): Promise<boolean> {
    const transitioned = await this.store.transitionRequest(input);
    if (transitioned) {
      this.gate.staffRequestTransitioned.open();
      await this.gate.allowStaffCommit.wait();
    }
    return transitioned;
  }

  transitionUserRole(input: StaffUserRoleTransition): Promise<boolean> {
    return this.store.transitionUserRole(input);
  }

  transitionUserAccountStatus(
    input: StaffUserAccountStatusTransition,
  ): Promise<boolean> {
    return this.store.transitionUserAccountStatus(input);
  }

  createApprovedReactivation(input: StaffRoleReactivationApproval) {
    return this.store.createApprovedReactivation(input);
  }
}

export class PausedStaffRoleRequestsRepository implements StaffRoleRequestsRepositoryPort {
  constructor(
    private readonly repository: StaffRoleRequestsRepositoryPort,
    private readonly gate: RoleRequestRaceGate,
  ) {}

  withTransaction<T>(
    operation: (store: StaffRoleRequestsTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.repository.withTransaction((store) =>
      operation(new PausedStaffRoleRequestsTransactionStore(store, this.gate)),
    );
  }

  findUserByGithubId(githubId: bigint): Promise<StaffRoleRequestActor | null> {
    return this.repository.findUserByGithubId(githubId);
  }

  list(query: StaffRoleRequestListQuery): Promise<{
    readonly items: readonly StaffRoleRequestRecord[];
    readonly total: number;
  }> {
    return this.repository.list(query);
  }
}

class PausedAdminAccessTransactionStore implements AdminAccessTransactionStore {
  constructor(
    private readonly store: AdminAccessTransactionStore,
    private readonly gate: RoleRequestRaceGate,
  ) {}

  get auditLogWriter() {
    return this.store.auditLogWriter;
  }

  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null> {
    return this.store.findActorByGithubId(githubId);
  }

  lockActiveAdmins(): Promise<number> {
    this.gate.unifiedAdminLockRequested.open();
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
}

export class PausedAdminAccessRepository implements AdminAccessRepositoryPort {
  constructor(
    private readonly repository: AdminAccessRepositoryPort,
    private readonly gate: RoleRequestRaceGate,
  ) {}

  withTransaction<T>(
    operation: (store: AdminAccessTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.repository.withTransaction((store) =>
      operation(new PausedAdminAccessTransactionStore(store, this.gate)),
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
