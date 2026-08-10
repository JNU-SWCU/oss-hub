import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';

export type AdminProfileTargetRecord = {
  readonly id: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

/**
 * `UserProfile` 행을 만들거나 갱신하는 데 필요한 완전한 값 — 그 테이블의 세 컬럼이
 * 전부 NOT NULL이라 부분 값으로는 쓸 수 없다.
 */
export type AdminProfileWriteFields = {
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
};

/** 학번이 없는(그리고 앞으로도 없을) 계정에 대한 구버전 `User` 컬럼 갱신 — 부분 갱신이다. */
export type AdminProfileLegacyFields = {
  readonly name?: string;
  readonly department?: string;
};

export type AdminProfileApplyOutcome = 'applied' | 'studentIdTaken';

export interface AdminProfileTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  findTarget(userId: string): Promise<AdminProfileTargetRecord | null>;
  /**
   * `UserProfile` 행을 upsert하고 구버전 `User` 컬럼도 같은 트랜잭션에서 맞춘다.
   *
   * `fields`는 행이 없을 때 새로 만드는 데 쓰는 전체 값이고, `changedFields`는 있는
   * 행을 갱신할 때 UPDATE 문에 실제로 실을 필드만 담는다(부분 갱신 — lost-update 방지,
   * #787 리뷰). 커맨드에 실리지 않은 필드는 `changedFields`에 넣지 않는다.
   */
  applyProfile(
    userId: string,
    fields: AdminProfileWriteFields,
    changedFields: Partial<AdminProfileWriteFields>,
  ): Promise<AdminProfileApplyOutcome>;
  applyLegacyFields(
    userId: string,
    fields: AdminProfileLegacyFields,
  ): Promise<void>;
}

export interface AdminProfileRepositoryPort {
  withTransaction<T>(
    operation: (store: AdminProfileTransactionStore) => Promise<T>,
  ): Promise<T>;
}
