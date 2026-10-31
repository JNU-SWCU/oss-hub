import type { AuditLogService } from '../platform/audit-log.service';
import { DomainException } from '../platform/error-code.error';
import { SystemErrorCode } from '../platform/system-error-code.error';
import { RolesErrorCode } from './roles-error-code.error';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.error';
import {
  USER_PROFILE_AUDIT_ACTIONS,
  USER_PROFILE_AUDIT_FIELDS,
} from '../platform/audit-log-metadata.config';
import type { UserProfileAuditAction } from '../platform/audit-log.repository';
import type {
  UserProfileAuditMetadata,
  UserProfileAuditFieldChange,
} from '../platform/audit-log-metadata.config';
import {
  type AdminProfileTargetRecord,
  type AdminProfileRepositoryPort,
} from './admin-profile.repository';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { Injectable } from '@nestjs/common';
import { UserProfileService } from './user-profile.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';

type AdminProfileFields = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

export type AdminProfileUpdateCommand = {
  readonly name?: string;
  readonly studentId?: string;
  readonly department?: string;
};

export type AdminProfileUpdateResult = AdminProfileFields & {
  readonly id: string;
};

type AdminProfileActor = {
  readonly name: string | null;
  readonly githubLogin: string;
};

type AdminProfileAudit = {
  readonly action: UserProfileAuditAction;
  readonly targetType: 'USER';
  readonly targetId: string;
  readonly metadata: UserProfileAuditMetadata;
};

function diffAdminProfileFields(
  before: AdminProfileFields,
  after: AdminProfileFields,
): UserProfileAuditFieldChange[] {
  const changes: UserProfileAuditFieldChange[] = [];
  if (before.name !== after.name) {
    changes.push({
      field: USER_PROFILE_AUDIT_FIELDS.NAME,
      before: before.name,
      after: after.name,
    });
  }
  if (before.studentId !== after.studentId) {
    changes.push({
      field: USER_PROFILE_AUDIT_FIELDS.STUDENT_ID,
      before: before.studentId,
      after: after.studentId,
    });
  }
  if (before.department !== after.department) {
    changes.push({
      field: USER_PROFILE_AUDIT_FIELDS.DEPARTMENT,
      before: before.department,
      after: after.department,
    });
  }
  return changes;
}

type MutationDependencies = {
  readonly repository: AdminProfileRepositoryPort;
  readonly auditLog: AuditLogService;
};

type MutationInput = {
  readonly actorGithubId: bigint;
  readonly userId: string;
  readonly command: AdminProfileUpdateCommand;
};

@Injectable()
export class AdminProfileMutationService {
  constructor(
    private readonly auditLogMetadataService: AuditLogMetadataService,
    private readonly userProfileService: UserProfileService,
    private readonly adminAccessMutationService: AdminAccessMutationService,
  ) {}

  async mutateAdminUserProfile(
    dependencies: MutationDependencies,
    input: MutationInput,
  ): Promise<AdminProfileUpdateResult> {
    return dependencies.repository.withTransaction(async (store) => {
      await store.lockActiveAdmins();
      const actor = this.adminAccessMutationService.requireActiveAdmin(
        await store.findActor(input.actorGithubId),
      );
      const before = await store.findTarget(input.userId);
      if (!before) {
        throw this.adminAccessMutationService.roleError(
          RolesErrorCode.USER_NOT_FOUND,
        );
      }

      if (
        input.command.studentId !== undefined &&
        !this.userProfileService.isValidStudentId(input.command.studentId)
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

      const audit = this.createAdminProfileAudit({
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

  private createAdminProfileAudit(input: {
    readonly actor: AdminProfileActor;
    readonly target: AdminProfileTargetRecord;
    readonly before: AdminProfileFields;
    readonly after: AdminProfileFields;
  }): AdminProfileAudit | null {
    const changes = diffAdminProfileFields(input.before, input.after);
    if (changes.length === 0) {
      return null;
    }
    return {
      action: USER_PROFILE_AUDIT_ACTIONS.PROFILE_UPDATED,
      targetType: 'USER',
      targetId: input.target.id,
      metadata: this.auditLogMetadataService.createUserProfileAuditMetadata({
        actor: {
          displayName: input.actor.name,
          githubLogin: input.actor.githubLogin,
        },

        target: {
          displayName: input.target.name,
          githubLogin: input.target.githubLogin,
        },
        changes,
      }),
    };
  }
}
