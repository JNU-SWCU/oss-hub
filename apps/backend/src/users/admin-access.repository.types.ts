import type { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import type {
  AdminAccessFacets,
  AdminAccessListQuery,
  AdminAccessLoginHistoryPage,
  AdminAccessRoleRequestHistoryPage,
  AdminAccessUser,
  AdminAccessUserDetail,
} from './domain/admin-access';

export type AdminAccessActor = {
  readonly id: string;
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
};

export type AdminAccessUserRecord = Omit<AdminAccessUser, 'isSelf'> & {
  readonly githubId: bigint;
};

export type AdminAccessUserDetailRecord = Omit<
  AdminAccessUserDetail,
  'isSelf'
> & {
  readonly githubId: bigint;
};

export type AdminAccessUserPageRecord = {
  readonly items: readonly AdminAccessUserRecord[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly facets: AdminAccessFacets;
};

export type AdminAccessUserUpdate = {
  readonly userId: string;
  readonly expectedRole: Role | null;
  readonly expectedAccountStatus: AccountStatus;
  readonly desiredRole: Role | null;
  readonly desiredAccountStatus: AccountStatus;
};

export type AdminAccessPendingDecisionUpdate = {
  readonly requestId: string;
  readonly actorId: string;
  readonly nextStatus:
    typeof RoleRequestStatus.APPROVED | typeof RoleRequestStatus.REJECTED;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date;
};

export interface AdminAccessTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null>;
  lockActiveAdmins(): Promise<number>;
  findUserForUpdate(userId: string): Promise<AdminAccessUserRecord | null>;
  compareAndSwapAccess(input: AdminAccessUserUpdate): Promise<boolean>;
  decidePendingRequest(
    input: AdminAccessPendingDecisionUpdate,
  ): Promise<boolean>;
}

export interface AdminAccessRepositoryPort {
  withTransaction<T>(
    operation: (store: AdminAccessTransactionStore) => Promise<T>,
  ): Promise<T>;
  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null>;
  list(query: AdminAccessListQuery): Promise<AdminAccessUserPageRecord>;
  facets(query: AdminAccessListQuery): Promise<AdminAccessFacets>;
  findById(userId: string): Promise<AdminAccessUserDetailRecord | null>;
  listRoleRequestHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessRoleRequestHistoryPage>;
  listLoginHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessLoginHistoryPage>;
}
