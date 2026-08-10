import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
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

/**
 * 실제 Prisma 트랜잭션 대신 메모리에서 `AdminProfileTransactionStore` 계약을
 * 흉내낸다 — `InMemoryAdminAccessRepository`(admin-access.service.spec-support.ts)와
 * 같은 패턴이다.
 */
export class InMemoryAdminProfileRepository
  implements AdminProfileRepositoryPort, AdminProfileTransactionStore
{
  readonly auditLogWriter = {} as AuditLogTransactionWriter;
  target: AdminProfileTargetRecord | null = profileTarget();
  applyOutcome: AdminProfileApplyOutcome = 'applied';
  legacyFieldsApplied: AdminProfileLegacyFields[] = [];
  profileFieldsApplied: AdminProfileWriteFields[] = [];
  /** `applyProfile`의 `changedFields` 인자 — 커맨드에 실제로 실린 필드만 담겨야 한다(lost-update 회귀 테스트용). */
  profileChangedFieldsApplied: Partial<AdminProfileWriteFields>[] = [];

  withTransaction<T>(
    operation: (store: AdminProfileTransactionStore) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  findTarget(): Promise<AdminProfileTargetRecord | null> {
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
