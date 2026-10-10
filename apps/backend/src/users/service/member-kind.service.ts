import { Inject, Injectable } from '@nestjs/common';
import {
  INDEPENDENT_AUTHORITY_AUDIT_ACTIONS,
  INDEPENDENT_AUTHORITY_AUDIT_COMMANDS,
  USER_PROFILE_AUDIT_ACTIONS,
  USER_PROFILE_AUDIT_FIELDS,
  createIndependentAuthorityAuditMetadata,
  createUserProfileAuditMetadata,
  type UserProfileAuditFieldChange,
} from '../../audit-log/domain/audit-log-metadata';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { DomainException } from '../../common/error-code';
import { SystemErrorCode } from '../../common/system-error-code.enum';
import { AffiliationKind, MemberKind } from '@prisma/client';
import { requireActiveAdmin } from './admin-access-authorization';
import { roleError, staleAccessError } from './admin-access-mutation-policy';
import { RolesErrorCode } from '../domain/roles-error-code.enum';
import { authorityLabel } from '../domain/authority-label';
import {
  isCompleteProfileFields,
  isStoredStudentId,
  isValidDepartment,
  isValidStudentId,
  normalizeProfileText,
} from '../domain/user-profile-policy';
import {
  isValidStaffNumber,
  normalizeStaffNumber,
  type MemberKindMutationCommand,
  type MemberKindMutationResult,
} from '../domain/member-kind';
import {
  MemberKindRepository,
  type MemberKindProfileUpdate,
  type MemberKindRepositoryPort,
  type MemberKindTargetRecord,
} from '../repository/member-kind.repository';
import {
  USERS_ERROR_CODES,
  UsersErrorCode,
} from '../domain/users-error-code.enum';

@Injectable()
export class MemberKindService {
  constructor(
    @Inject(MemberKindRepository)
    private readonly repository: MemberKindRepositoryPort,
    @Inject(AuditLogService)
    private readonly auditLog: Pick<AuditLogService, 'record'>,
  ) {}

  patchMemberKind(
    actorGithubId: bigint,
    userId: string,
    command: MemberKindMutationCommand,
  ): Promise<MemberKindMutationResult> {
    assertCommandShape(command);
    return this.repository.withTransaction(async (store) => {
      await store.lockActiveAdmins();
      const actor = requireActiveAdmin(
        await store.findActorByGithubId(actorGithubId),
      );
      const before = await store.findTargetForUpdate(userId);
      if (!before) {
        throw roleError(RolesErrorCode.USER_NOT_FOUND);
      }
      if (
        !before.profile ||
        !isCompleteProfileFields(before.profile, before.memberKind)
      ) {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.PROFILE_INCOMPLETE],
        );
      }
      if (
        before.memberKind !== command.expectedMemberKind ||
        before.hasStaffAccess !== command.expectedHasStaffAccess
      ) {
        throw staleAccessError(before);
      }
      if (before.pendingRequest) {
        throw roleError(RolesErrorCode.PENDING_REQUEST_DECISION_REQUIRED);
      }

      const update = resolveMemberKindUpdate(before, command);
      if (!update.changed) {
        throw staleAccessError(before);
      }
      const outcome = await store.updateMemberKind(
        before.id,
        update.hasStaffAccess,
        command.memberKind,
        update.profile,
      );
      if (outcome === 'studentIdTaken') {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_TAKEN_BY_ADMIN],
        );
      }

      if (before.hasStaffAccess && !update.hasStaffAccess) {
        await store.insertRevokedRequest({
          userId: before.id,
          actorId: actor.id,
          decidedAt: new Date(),
        });
      }

      const after = {
        memberKind: command.memberKind,
        hasStaffAccess: update.hasStaffAccess,
        hasAdminAccess: before.hasAdminAccess,
        role: update.role,
        accountStatus: before.accountStatus,
      };
      if (update.authorityChanged) {
        await this.auditLog.record(
          {
            actorGithubId,
            action: INDEPENDENT_AUTHORITY_AUDIT_ACTIONS.SET_MEMBER_KIND,
            targetType: 'USER',
            targetId: before.id,
            metadata: createIndependentAuthorityAuditMetadata({
              command: INDEPENDENT_AUTHORITY_AUDIT_COMMANDS.SET_MEMBER_KIND,
              actor: {
                displayName: actor.name,
                githubLogin: actor.githubLogin,
              },
              target: {
                displayName: before.name,
                githubLogin: before.githubLogin,
              },
              before: {
                memberKind: before.memberKind,
                hasStaffAccess: before.hasStaffAccess,
                hasAdminAccess: before.hasAdminAccess,
                role: before.role,
                accountStatus: before.accountStatus,
              },
              after,
            }),
          },
          store.auditLogWriter,
        );
      }
      if (update.profileChanges.length > 0) {
        await this.auditLog.record(
          {
            actorGithubId,
            action: USER_PROFILE_AUDIT_ACTIONS.PROFILE_UPDATED,
            targetType: 'USER',
            targetId: before.id,
            metadata: createUserProfileAuditMetadata({
              actor: {
                displayName: actor.name,
                githubLogin: actor.githubLogin,
              },
              target: {
                displayName: before.name,
                githubLogin: before.githubLogin,
              },
              changes: update.profileChanges,
            }),
          },
          store.auditLogWriter,
        );
      }

      return {
        id: before.id,
        role: after.role,
        memberKind: after.memberKind,
        hasStaffAccess: after.hasStaffAccess,
        hasAdminAccess: after.hasAdminAccess,
      };
    });
  }
}

type MemberKindUpdate = {
  readonly changed: boolean;
  readonly authorityChanged: boolean;
  readonly hasStaffAccess: boolean;
  readonly role: MemberKindTargetRecord['role'];
  readonly profileChanges: readonly UserProfileAuditFieldChange[];
  readonly profile: MemberKindProfileUpdate;
};

function resolveMemberKindUpdate(
  before: MemberKindTargetRecord,
  command: MemberKindMutationCommand,
): MemberKindUpdate {
  const profile = before.profile;
  if (!profile) {
    throw new DomainException(
      USERS_ERROR_CODES[UsersErrorCode.PROFILE_INCOMPLETE],
    );
  }

  const providedStudentId = parseStudentId(command.studentId);
  const providedDepartment = parseDepartment(command.department);
  const providedStaffNumber = parseStaffNumber(command.staffNumber);

  if (command.memberKind === MemberKind.STUDENT) {
    if (
      profile.studentId !== null &&
      providedStudentId !== undefined &&
      providedStudentId !== profile.studentId
    ) {
      throw validationError('학생 전환에서는 기존 학번을 변경할 수 없습니다.');
    }
    const studentId = providedStudentId ?? profile.studentId;
    if (studentId === null || !isStoredStudentId(studentId)) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.PROFILE_INCOMPLETE],
      );
    }
    if (providedDepartment === undefined) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_NEEDS_DEPARTMENT],
      );
    }
    const hasStaffAccess = false;
    const profilePatch = {
      memberKind: MemberKind.STUDENT,
      ...(studentId !== profile.studentId ? { studentId } : {}),
      department: providedDepartment,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: providedDepartment,
      ...(providedStaffNumber !== undefined
        ? { staffNumber: providedStaffNumber }
        : {}),
    };
    const authorityChanged =
      before.memberKind !== MemberKind.STUDENT ||
      before.hasStaffAccess !== hasStaffAccess;
    const profileChanges = profileAuditChanges({
      before: profile,
      studentId,
      department: providedDepartment,
      staffNumber: providedStaffNumber,
    });
    const changed =
      authorityChanged ||
      profileChanges.length > 0 ||
      profile.affiliationKind !== AffiliationKind.DEPARTMENT ||
      profile.affiliationName !== providedDepartment;
    return {
      changed,
      authorityChanged,
      hasStaffAccess,
      role: authorityLabel({
        memberKind: MemberKind.STUDENT,
        hasStaffAccess,
        hasAdminAccess: before.hasAdminAccess,
      }),
      profileChanges,
      profile: profilePatch,
    };
  }

  if (
    providedStudentId !== undefined &&
    providedStudentId !== profile.studentId
  ) {
    throw validationError('교직원 전환에서는 기존 학번을 변경할 수 없습니다.');
  }
  if (
    providedDepartment !== undefined &&
    (providedDepartment !== profile.department ||
      providedDepartment !== profile.affiliationName)
  ) {
    throw validationError('교직원 전환에서는 기존 소속을 변경할 수 없습니다.');
  }

  const hasStaffAccess = true;
  const profilePatch = {
    memberKind: MemberKind.STAFF,
    ...(providedStaffNumber !== undefined
      ? { staffNumber: providedStaffNumber }
      : {}),
  };
  const authorityChanged =
    before.memberKind !== MemberKind.STAFF ||
    before.hasStaffAccess !== hasStaffAccess;
  const profileChanges = profileAuditChanges({
    before: profile,
    studentId: profile.studentId,
    department: profile.department,
    staffNumber: providedStaffNumber,
  });
  const changed = authorityChanged || profileChanges.length > 0;
  return {
    changed,
    authorityChanged,
    hasStaffAccess,
    role: authorityLabel({
      memberKind: MemberKind.STAFF,
      hasStaffAccess,
      hasAdminAccess: before.hasAdminAccess,
    }),
    profileChanges,
    profile: profilePatch,
  };
}

function parseStudentId(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw validationError('학번 형식이 올바르지 않습니다.');
  }
  const normalized = value.trim();
  if (!isValidStudentId(normalized)) {
    throw validationError('학번 형식이 올바르지 않습니다.');
  }
  return normalized;
}

function assertCommandShape(command: MemberKindMutationCommand): void {
  if (
    command.memberKind !== MemberKind.STUDENT &&
    command.memberKind !== MemberKind.STAFF
  ) {
    throw validationError('지원하지 않는 회원 유형입니다.');
  }
  if (
    command.expectedMemberKind !== MemberKind.STUDENT &&
    command.expectedMemberKind !== MemberKind.STAFF
  ) {
    throw validationError('기대하는 회원 유형이 올바르지 않습니다.');
  }
  if (typeof command.expectedHasStaffAccess !== 'boolean') {
    throw validationError('기대하는 교직원 접근 상태가 올바르지 않습니다.');
  }
}

function parseDepartment(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw validationError('학과 형식이 올바르지 않습니다.');
  }
  const normalized = normalizeProfileText(value);
  if (!isValidDepartment(normalized)) {
    throw validationError('학과 형식이 올바르지 않습니다.');
  }
  return normalized;
}

function parseStaffNumber(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== 'string') {
    throw validationError('교직원 번호 형식이 올바르지 않습니다.');
  }
  const normalized = normalizeStaffNumber(value);
  if (!isValidStaffNumber(normalized)) {
    throw validationError('교직원 번호 형식이 올바르지 않습니다.');
  }
  return normalized;
}

function profileAuditChanges(input: {
  readonly before: NonNullable<MemberKindTargetRecord['profile']>;
  readonly studentId: string | null;
  readonly department: string;
  readonly staffNumber: string | null | undefined;
}): UserProfileAuditFieldChange[] {
  const changes: UserProfileAuditFieldChange[] = [];
  const nextStaffNumber =
    input.staffNumber === undefined
      ? input.before.staffNumber
      : input.staffNumber;
  if (input.before.studentId !== input.studentId) {
    changes.push({
      field: USER_PROFILE_AUDIT_FIELDS.STUDENT_ID,
      before: input.before.studentId,
      after: input.studentId,
    });
  }
  if (input.before.department !== input.department) {
    changes.push({
      field: USER_PROFILE_AUDIT_FIELDS.DEPARTMENT,
      before: input.before.department,
      after: input.department,
    });
  }
  if (input.before.staffNumber !== nextStaffNumber) {
    changes.push({
      field: USER_PROFILE_AUDIT_FIELDS.STAFF_NUMBER,
      before: input.before.staffNumber,
      after: nextStaffNumber,
    });
  }
  return changes;
}

function validationError(message: string): DomainException {
  return new DomainException({
    code: SystemErrorCode.VALIDATION_FAILED,
    status: 400,
    message,
  });
}
