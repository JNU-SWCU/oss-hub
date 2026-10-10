import type { AuditLogService } from '../audit-log/service/audit-log.service';
import { DomainException } from '../common/error-code';
import { SystemErrorCode } from '../common/system-error-code.enum';
import { RolesErrorCode } from './domain/roles-error-code.enum';
import { createAdminProfileAudit } from './admin-profile-audit';
import { requireActiveAdmin } from './admin-access-authorization';
import { roleError } from './admin-access-mutation-policy';
import { isValidStudentId } from './domain/user-profile-policy';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.enum';
import type {
  AdminProfileFields,
  AdminProfileUpdateCommand,
  AdminProfileUpdateResult,
} from './domain/admin-profile';
import type { AdminProfileRepositoryPort } from './admin-profile.repository.types';

type MutationDependencies = {
  readonly repository: AdminProfileRepositoryPort;
  readonly auditLog: AuditLogService;
};

type MutationInput = {
  readonly actorGithubId: bigint;
  readonly userId: string;
  readonly command: AdminProfileUpdateCommand;
};

export async function mutateAdminUserProfile(
  dependencies: MutationDependencies,
  input: MutationInput,
): Promise<AdminProfileUpdateResult> {
  return dependencies.repository.withTransaction(async (store) => {
    await store.lockActiveAdmins();
    const actor = requireActiveAdmin(
      await store.findActor(input.actorGithubId),
    );
    const before = await store.findTarget(input.userId);
    if (!before) {
      throw roleError(RolesErrorCode.USER_NOT_FOUND);
    }

    if (
      input.command.studentId !== undefined &&
      !isValidStudentId(input.command.studentId)
    ) {
      throw new DomainException({
        code: SystemErrorCode.VALIDATION_FAILED,
        status: 400,
        message: '학번 형식이 올바르지 않습니다.',
      });
    }

    if (
      input.command.studentId !== undefined &&
      before.memberKind === 'STAFF'
    ) {
      throw new DomainException({
        code: SystemErrorCode.VALIDATION_FAILED,
        status: 400,
        message: '교직원 프로필에는 학번을 저장할 수 없습니다.',
      });
    }

    const nextName = input.command.name ?? before.name;
    const nextStudentId = input.command.studentId ?? before.studentId;
    const nextDepartment = input.command.department ?? before.department;

    if (nextStudentId !== null) {
      if (nextDepartment === null) {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_NEEDS_DEPARTMENT],
        );
      }

      if (nextName === null) {
        throw new DomainException({
          code: SystemErrorCode.VALIDATION_FAILED,
          status: 400,
          message: '학번을 저장하려면 이름이 먼저 있어야 합니다.',
        });
      }
      const outcome = await store.applyProfile(
        input.userId,
        {
          name: nextName,
          studentId: nextStudentId,
          department: nextDepartment,
        },
        {
          ...(input.command.name !== undefined
            ? { name: input.command.name }
            : {}),
          ...(input.command.studentId !== undefined
            ? { studentId: input.command.studentId }
            : {}),
          ...(input.command.department !== undefined
            ? { department: input.command.department }
            : {}),
        },
      );
      if (outcome === 'studentIdTaken') {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_TAKEN_BY_ADMIN],
        );
      }
    } else {
      await store.applyLegacyFields(input.userId, {
        ...(input.command.name !== undefined
          ? { name: input.command.name }
          : {}),
        ...(input.command.department !== undefined
          ? { department: input.command.department }
          : {}),
      });
    }

    const after: AdminProfileFields = {
      name: nextName,
      studentId: nextStudentId,
      department: nextDepartment,
    };

    const audit = createAdminProfileAudit({
      actor: { name: actor.name, githubLogin: actor.githubLogin },
      target: before,
      before,
      after,
    });
    if (audit) {
      await dependencies.auditLog.record(
        {
          actorGithubId: input.actorGithubId,
          action: audit.action,
          targetType: audit.targetType,
          targetId: audit.targetId,
          metadata: audit.metadata,
        },
        store.auditLogWriter,
      );
    }

    return { id: input.userId, ...after };
  });
}
