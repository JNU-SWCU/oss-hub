import type { AuditLogTransactionWriter } from '../audit-log/repository/audit-log.repository';
import { adminActor } from './admin-access.service.spec-support';
import type { AdminAccessActor } from './admin-access.repository.types';
import type {
  AdminProfileApplyOutcome,
  AdminProfileLegacyFields,
  AdminProfileRepositoryPort,
  AdminProfileTargetRecord,
  AdminProfileTransactionStore,
  AdminProfileWriteFields,
} from './admin-profile.repository.types';

export function profileTarget(
  overrides: Partial<AdminProfileTargetRecord> = {},
): AdminProfileTargetRecord {
  return {
    id: 'target',
    githubLogin: 'synthetic-target',
    name: '합성 사용자',
    studentId: null,
    department: null,
    ...overrides,
  };
}

export class InMemoryAdminProfileRepository
  implements AdminProfileRepositoryPort, AdminProfileTransactionStore
{
  readonly auditLogWriter = {} as AuditLogTransactionWriter;
  actor: AdminAccessActor | null = adminActor();
  target: AdminProfileTargetRecord | null = profileTarget();

  operations: string[] = [];
  applyOutcome: AdminProfileApplyOutcome = 'applied';
  legacyFieldsApplied: AdminProfileLegacyFields[] = [];
  profileFieldsApplied: AdminProfileWriteFields[] = [];

  profileChangedFieldsApplied: Partial<AdminProfileWriteFields>[] = [];

  withTransaction<T>(
    operation: (store: AdminProfileTransactionStore) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  lockActiveAdmins(): Promise<void> {
    this.operations.push('lock-active-admins');
    return Promise.resolve();
  }

  findActor(): Promise<AdminAccessActor | null> {
    this.operations.push('find-actor');
    return Promise.resolve(this.actor);
  }

  findTarget(): Promise<AdminProfileTargetRecord | null> {
    this.operations.push('find-target');
    return Promise.resolve(this.target);
  }

  applyProfile(
    _userId: string,
    fields: AdminProfileWriteFields,
    changedFields: Partial<AdminProfileWriteFields>,
  ): Promise<AdminProfileApplyOutcome> {
    this.profileFieldsApplied.push(fields);
    this.profileChangedFieldsApplied.push(changedFields);
    if (this.applyOutcome === 'applied' && this.target) {
      this.target = { ...this.target, ...fields };
    }
    return Promise.resolve(this.applyOutcome);
  }

  applyLegacyFields(
    _userId: string,
    fields: AdminProfileLegacyFields,
  ): Promise<void> {
    this.legacyFieldsApplied.push(fields);
    if (this.target) {
      this.target = { ...this.target, ...fields };
    }
    return Promise.resolve();
  }
}
