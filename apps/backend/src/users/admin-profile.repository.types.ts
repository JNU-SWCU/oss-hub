import type { MemberKind } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/repository/audit-log.repository';
import type { AdminAccessActor } from './admin-access.repository.types';

export type AdminProfileTargetRecord = {
  readonly id: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly memberKind?: MemberKind | null;
};

export type AdminProfileWriteFields = {
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
};

export type AdminProfileLegacyFields = {
  readonly name?: string;
  readonly department?: string;
};

export type AdminProfileApplyOutcome = 'applied' | 'studentIdTaken';

export interface AdminProfileTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;

  lockActiveAdmins(): Promise<void>;
  findActor(githubId: bigint): Promise<AdminAccessActor | null>;
  findTarget(userId: string): Promise<AdminProfileTargetRecord | null>;

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
