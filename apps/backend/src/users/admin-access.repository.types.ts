import type {
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import type { AuthorityLabel } from '../common/authority-label';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import type {
  AdminAccessFacets,
  AdminAccessListQuery,
  AdminAccessLoginHistoryPage,
  AdminAccessStaffAccessRequestHistoryPage,
  AdminAccessUser,
  AdminAccessUserDetail,
} from './domain/admin-access';

export type AdminAccessActor = {
  readonly id: string;
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly name: string | null;
  /** legacy 투영치 — 감사 로그와 응답 호환성용이다. 인가 판정은 아래 canonical 칸이 원본이다. */
  readonly role: AuthorityLabel | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
};

export type AdminAccessUserRecord = Omit<AdminAccessUser, 'isSelf'> & {
  readonly githubId: bigint;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export type AdminAccessUserDetailRecord = Omit<
  AdminAccessUserDetail,
  'isSelf'
> & {
  readonly githubId: bigint;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
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
  /**
   * CAS 기준값 — 관리자가 화면에서 보고 있던 그 상태다.
   *
   * 표시 역할(`expectedRole`)은 세 사실을 접은 요약이라 CAS 기준으로 쓸 수 없다.
   * 서로 다른 canonical 상태가 같은 표시 값으로 접히면 CAS가 통과해 관리자가 보지
   * 못한 상태를 덮어쓴다. 그래서 DB 조건은 canonical 두 칸을 그대로 건다.
   */
  readonly expectedHasStaffAccess: boolean;
  readonly expectedHasAdminAccess: boolean;
  readonly expectedAccountStatus: AccountStatus;
  readonly desiredAccountStatus: AccountStatus;
  readonly desiredHasStaffAccess: boolean;
  readonly desiredHasAdminAccess: boolean;
};

export type AdminAccessPendingDecisionUpdate = {
  readonly requestId: string;
  readonly actorId: string;
  readonly nextStatus:
    | typeof StaffAccessRequestStatus.APPROVED
    | typeof StaffAccessRequestStatus.REJECTED;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date;
};

export type AdminAccessRevokedRequestInsert = {
  readonly userId: string;
  readonly actorId: string;
  readonly decidedAt: Date;
};

export type AdminAccessInsertedRequest = {
  readonly id: string;
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
  /**
   * 회수를 요청 이력에 남긴다 — 기존 APPROVED 행을 갱신하지 않고 **새 행을 넣는다**(#184).
   *
   * `decidePendingRequest`와 짝이 아니다. 그쪽은 PENDING 행 하나를 노리는 CAS라 경쟁하는
   * 두 관리자 중 한쪽만 이기게 만드는 것이 목적이지만, 회수의 경쟁 차단은 이미 `User` 행의
   * compare-and-swap이 맡고 있어 여기서는 삽입만 하면 된다. 승인 이력("누가 언제 승인했는가")은
   * 장학금 근거로 쓰이므로 덮어쓰지 않는다.
   */
  insertRevokedRequest(
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest>;
}

export interface AdminAccessRepositoryPort {
  withTransaction<T>(
    operation: (store: AdminAccessTransactionStore) => Promise<T>,
  ): Promise<T>;
  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null>;
  list(query: AdminAccessListQuery): Promise<AdminAccessUserPageRecord>;
  facets(query: AdminAccessListQuery): Promise<AdminAccessFacets>;
  findById(userId: string): Promise<AdminAccessUserDetailRecord | null>;
  listStaffAccessRequestHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessStaffAccessRequestHistoryPage>;
  listLoginHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessLoginHistoryPage>;
}
