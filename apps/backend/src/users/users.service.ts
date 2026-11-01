import { Inject, Injectable } from '@nestjs/common';
import { AuditLogService } from '../platform/audit-log.service';
import {
  USER_PROFILE_AUDIT_ACTIONS,
  USER_PHONE_AUDIT_TRANSITIONS,
  USER_PROFILE_AUDIT_FIELDS,
} from '../platform/audit-log-metadata.config';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.error';
import { DomainException } from '../platform/error-code.error';
import { SystemErrorCode } from '../platform/system-error-code.error';
import { ConsentsService } from './consents.service';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.error';
import {
  UsersRepository,
  type RecordPhoneAudit,
  type RecordStaffNumberAudit,
  type UsersRepositoryPort,
  CompleteUserProfileInput,
  type UpdateProfileFieldsInput,
} from './users.repository';
import { type UserProfileRecord } from './profile-validation.config';
import { AffiliationKind, MemberKind } from '@prisma/client';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { UserProfileService } from './user-profile.service';

export interface UserProfile {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly phone: string | null;
  readonly staffNumber: string | null;
  readonly isComplete: boolean;
}

export interface PatchUserProfileInput {
  readonly name: string;
  readonly studentId?: string;
  readonly department?: string;
  readonly phone?: string;
  readonly staffNumber?: string | null;
  readonly affiliationKind?: AffiliationKind;
  readonly affiliationName?: string;
}

type NormalizedProfileRecord = Omit<
  UserProfileRecord,
  'name' | 'department'
> & {
  readonly name: string;
  readonly department: string;
};

function nextProfileRecord(
  user: UserProfileRecord,
  input: CompleteUserProfileInput,
): NormalizedProfileRecord {
  return {
    ...user,
    name: input.name,
    studentId: input.studentId,
    department: input.department,
    phone: input.phone ?? user.phone,
    memberKind: input.memberKind,
    affiliationKind: input.affiliationKind,
    affiliationName: input.affiliationName,
    hasStaffAccess: input.hasStaffAccess,
    hasAdminAccess: input.hasAdminAccess,
  };
}

type Affiliation = {
  readonly kind: AffiliationKind;
  readonly name: string;
};

function requireAllowedAffiliation(
  memberKind: MemberKind,
  affiliationKind: AffiliationKind,
): void {
  switch (memberKind) {
    case MemberKind.STUDENT:
      if (affiliationKind !== AffiliationKind.DEPARTMENT) {
        throw invalidProfile('학생 소속은 학과여야 합니다.');
      }
      return;
    case MemberKind.STAFF:
      return;
  }
}

function invalidProfile(message: string): DomainException {
  return new DomainException({
    code: SystemErrorCode.VALIDATION_FAILED,
    status: 400,
    message,
  });
}

export interface UpdateMyProfileRequest {
  readonly name: string;
  readonly studentId?: string;
  readonly phone?: string;
  readonly staffNumber?: string | null;
  readonly department?: string;
  readonly affiliationKind?: string;
  readonly affiliationName?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(UsersRepository)
    private readonly repository: UsersRepositoryPort,
    @Inject(ConsentsService)
    private readonly consentsService: Pick<ConsentsService, 'requireCurrent'>,
    @Inject(AuditLogService)
    private readonly auditLog: Pick<AuditLogService, 'record'>,
    private readonly auditLogMetadataService: AuditLogMetadataService,
    private readonly userProfileService: UserProfileService,
  ) {}

  profileInputFromRequest(
    request: UpdateMyProfileRequest,
  ): PatchUserProfileInput {
    return {
      name: request.name,
      ...(typeof request.studentId === 'string'
        ? { studentId: request.studentId }
        : {}),
      ...(typeof request.department === 'string'
        ? { department: request.department }
        : {}),
      ...(typeof request.phone === 'string' ? { phone: request.phone } : {}),
      ...(request.staffNumber !== undefined
        ? { staffNumber: request.staffNumber }
        : {}),
      ...(typeof request.affiliationKind === 'string'
        ? {
            affiliationKind: this.parseRequestedAffiliationKind(
              request.affiliationKind,
            ),
          }
        : {}),
      ...(typeof request.affiliationName === 'string'
        ? { affiliationName: request.affiliationName }
        : {}),
    };
  }

  private parseRequestedAffiliationKind(value: string): AffiliationKind {
    switch (value) {
      case AffiliationKind.DEPARTMENT:
      case AffiliationKind.PROGRAM_OFFICE:
        return value;
      default:
        throw new DomainException({
          code: SystemErrorCode.VALIDATION_FAILED,
          status: 400,
          message: '지원하지 않는 소속 유형입니다.',
        });
    }
  }

  async getMyProfile(githubId: bigint): Promise<UserProfile> {
    await this.consentsService.requireCurrent(githubId);
    return this.toUserProfile(await this.requireUser(githubId));
  }

  async requireCompleteProfile(githubId: bigint): Promise<void> {
    const profile = this.toUserProfile(await this.requireUser(githubId));
    if (!profile.isComplete) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.PROFILE_INCOMPLETE],
      );
    }
  }

  completeMyProfileFromRequest(
    githubId: bigint,
    request: UpdateMyProfileRequest,
  ): Promise<UserProfile> {
    return this.completeMyProfile(
      githubId,
      this.profileInputFromRequest(request),
    );
  }

  patchMyProfileFromRequest(
    githubId: bigint,
    request: UpdateMyProfileRequest,
  ): Promise<UserProfile> {
    return this.patchMyProfile(githubId, this.profileInputFromRequest(request));
  }

  async completeMyProfile(
    githubId: bigint,
    input: PatchUserProfileInput,
  ): Promise<UserProfile> {
    const user = await this.requireWritableUser(githubId, input);
    if (this.userProfileService.isCompleteUserProfile(user)) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.PROFILE_ALREADY_COMPLETE],
      );
    }
    const completion = this.buildProfileCompletion(user, input);
    const outcome = await this.repository.completeProfileIfUnchanged(
      user,
      completion,
      this.recordPhoneAudit,
    );
    switch (outcome) {
      case 'completed':
        return this.toUserProfile(nextProfileRecord(user, completion));
      case 'student-id-taken':
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_TAKEN],
        );
      case 'conflict':
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.PROFILE_ALREADY_COMPLETE],
        );
    }
  }

  async patchMyProfile(
    githubId: bigint,
    input: PatchUserProfileInput,
  ): Promise<UserProfile> {
    const user = await this.requireWritableUser(githubId, input);
    if (!this.userProfileService.isCompleteUserProfile(user)) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.PROFILE_COMPLETE_REQUIRES_POST],
      );
    }
    const fields = this.buildProfileUpdate(user, input);
    const next: UserProfileRecord = {
      ...user,
      ...fields,
      affiliationKind: fields.affiliationKind ?? user.affiliationKind,
      affiliationName: fields.affiliationName ?? user.affiliationName,
      studentId: input.studentId ?? user.studentId,
      phone: fields.phone ?? user.phone,
    };
    const changesExistingStudentId =
      input.studentId !== undefined &&
      user.studentId !== null &&
      input.studentId !== user.studentId;
    if (changesExistingStudentId) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_IMMUTABLE],
      );
    }
    const fillsStudentId =
      input.studentId !== undefined && user.studentId === null;
    if (
      fillsStudentId &&
      !this.userProfileService.isValidStudentId(input.studentId)
    ) {
      throw new DomainException({
        code: SystemErrorCode.VALIDATION_FAILED,
        status: 400,
        message: '학번 형식이 올바르지 않습니다.',
      });
    }
    if (fillsStudentId) {
      await this.fillStudentId(
        user,
        {
          name: fields.name,
          department: fields.department,
          ...(fields.phone === undefined ? {} : { phone: fields.phone }),
        },
        input.studentId,
      );
      return this.toUserProfile(next);
    }
    await this.repository.updateProfileFields(
      user,
      fields,
      this.recordStaffNumberAudit,
      this.recordPhoneAudit,
    );
    return this.toUserProfile(next);
  }

  private async requireWritableUser(
    githubId: bigint,
    input: PatchUserProfileInput,
  ): Promise<UserProfileRecord> {
    await this.consentsService.requireCurrent(githubId);
    const user = await this.requireUser(githubId);
    if (
      input.studentId !== undefined &&
      !this.userProfileService.profileFieldRequirement(
        this.userProfileService.effectiveProfileMemberKind(user),
      ).studentId
    ) {
      throw new DomainException({
        code: SystemErrorCode.VALIDATION_FAILED,
        status: 400,
        message: '학번은 학생만 저장할 수 있습니다.',
      });
    }
    return user;
  }

  private async fillStudentId(
    user: UserProfileRecord,
    next: {
      readonly name: string;
      readonly department: string | null;
      readonly phone?: string;
    },
    studentId: string,
  ): Promise<void> {
    if (next.department === null) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_NEEDS_DEPARTMENT],
      );
    }
    const outcome = await this.repository.fillStudentId(
      {
        expected: user,
        studentId,
        ...(next.phone === undefined ? {} : { phone: next.phone }),
      },
      this.recordPhoneAudit,
    );
    switch (outcome) {
      case 'filled':
        return;
      case 'taken':
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_TAKEN],
        );
      case 'conflict':
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_IMMUTABLE],
        );
    }
  }

  private readonly recordStaffNumberAudit: RecordStaffNumberAudit = async (
    store,
    change,
  ) => {
    await this.auditLog.record(
      {
        actorGithubId: change.user.githubId,
        action: USER_PROFILE_AUDIT_ACTIONS.PROFILE_UPDATED,
        targetType: 'USER',
        targetId: change.user.id,
        metadata: this.auditLogMetadataService.createUserProfileAuditMetadata({
          actor: {
            displayName: change.user.name,
            githubLogin: change.user.githubLogin,
          },
          target: {
            displayName: change.user.name,
            githubLogin: change.user.githubLogin,
          },
          changes: [
            {
              field: USER_PROFILE_AUDIT_FIELDS.STAFF_NUMBER,
              before: change.before,
              after: change.after,
            },
          ],
        }),
      },
      store.auditLogWriter,
    );
  };

  private readonly recordPhoneAudit: RecordPhoneAudit = async (
    store,
    change,
  ) => {
    await this.auditLog.record(
      {
        actorGithubId: change.user.githubId,
        action: USER_PROFILE_AUDIT_ACTIONS.PHONE_UPDATED,
        targetType: 'USER',
        targetId: change.user.id,
        metadata: this.auditLogMetadataService.createUserPhoneAuditMetadata({
          actor: {
            displayName: change.user.name,
            githubLogin: change.user.githubLogin,
          },
          target: {
            displayName: change.user.name,
            githubLogin: change.user.githubLogin,
          },
          transition:
            change.transition === 'set'
              ? USER_PHONE_AUDIT_TRANSITIONS.SET
              : USER_PHONE_AUDIT_TRANSITIONS.REPLACED,
        }),
      },
      store.auditLogWriter,
    );
  };

  private async requireUser(githubId: bigint): Promise<UserProfileRecord> {
    const user = await this.repository.findByGithubId(githubId);
    if (!user) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    return user;
  }

  private toUserProfile(record: UserProfileRecord): UserProfile {
    return {
      name: record.name ?? '',
      studentId: record.studentId,
      department: record.department,
      phone: record.phone ?? null,
      staffNumber: record.staffNumber ?? null,
      isComplete: this.userProfileService.isCompleteUserProfile(record),
    };
  }

  private buildProfileUpdate(
    user: UserProfileRecord,
    input: PatchUserProfileInput,
  ): UpdateProfileFieldsInput {
    if (
      input.staffNumber !== undefined &&
      user.memberKind !== MemberKind.STAFF
    ) {
      throw invalidProfile('교직원 번호는 교직원만 수정할 수 있습니다.');
    }
    const name = this.userProfileService.normalizeProfileText(input.name);
    if (!this.userProfileService.isValidUserName(name)) {
      throw invalidProfile('이름 형식이 올바르지 않습니다.');
    }
    const affiliation = this.resolveAffiliation(user, input);
    const memberKind = user.memberKind ?? user.selectedMemberKind ?? null;
    if (memberKind !== null) {
      requireAllowedAffiliation(memberKind, affiliation.kind);
    }
    return {
      name,
      department: affiliation.name,
      ...this.patchPhone(input),
      ...this.patchStaffNumber(input),
      ...(memberKind === null
        ? {}
        : {
            affiliationKind: affiliation.kind,
            affiliationName: affiliation.name,
          }),
    };
  }

  private completionPhone(
    memberKind: MemberKind,
    user: UserProfileRecord,
    input: PatchUserProfileInput,
  ): { readonly phone?: string } {
    const phone = this.patchPhone(input);
    if (
      memberKind === MemberKind.STUDENT &&
      phone.phone === undefined &&
      (user.phone === null || user.phone === undefined)
    ) {
      throw invalidProfile('학생 가입에는 연락처가 필요합니다.');
    }
    return phone;
  }

  private patchPhone(input: PatchUserProfileInput): {
    readonly phone?: string;
  } {
    if (input.phone === undefined) {
      return {};
    }
    if (!this.userProfileService.isValidPhone(input.phone)) {
      throw invalidProfile('연락처 형식이 올바르지 않습니다.');
    }
    return { phone: input.phone };
  }

  private patchStaffNumber(input: PatchUserProfileInput): {
    readonly staffNumber?: string | null;
  } {
    if (input.staffNumber === undefined) {
      return {};
    }
    if (input.staffNumber === null) {
      return { staffNumber: null };
    }
    if (typeof input.staffNumber !== 'string') {
      throw invalidProfile('교직원 번호 형식이 올바르지 않습니다.');
    }
    const normalized = this.userProfileService.normalizeStaffNumber(
      input.staffNumber,
    );
    if (normalized === '') {
      return { staffNumber: null };
    }
    if (!this.userProfileService.isValidStaffNumber(normalized)) {
      throw invalidProfile('교직원 번호 형식이 올바르지 않습니다.');
    }
    return { staffNumber: normalized };
  }

  private resolveAffiliation(
    user: UserProfileRecord,
    input: PatchUserProfileInput,
  ): Affiliation {
    const hasKind = input.affiliationKind !== undefined;
    const hasName = input.affiliationName !== undefined;
    if (hasKind !== hasName || (hasKind && input.department !== undefined)) {
      throw invalidProfile('소속 유형과 이름을 하나의 형식으로 보내 주세요.');
    }
    const kind = hasKind
      ? input.affiliationKind
      : (user.affiliationKind ?? AffiliationKind.DEPARTMENT);
    const rawName = hasName ? input.affiliationName : input.department;
    if (kind === undefined || rawName === undefined) {
      throw invalidProfile('소속을 입력해 주세요.');
    }
    const name = this.userProfileService.normalizeProfileText(rawName);
    if (!this.userProfileService.isValidDepartment(name)) {
      throw invalidProfile('소속 형식이 올바르지 않습니다.');
    }
    return { kind, name };
  }

  private completionStudentId(
    memberKind: MemberKind,
    user: UserProfileRecord,
    input: PatchUserProfileInput,
  ): string | null {
    switch (memberKind) {
      case MemberKind.STUDENT: {
        const studentId = input.studentId ?? user.studentId;
        const valid =
          studentId !== null &&
          (input.studentId === undefined
            ? this.userProfileService.isStoredStudentId(studentId)
            : this.userProfileService.isValidStudentId(studentId));
        if (!valid) {
          throw invalidProfile('학생 가입에는 학번이 필요합니다.');
        }
        return studentId;
      }
      case MemberKind.STAFF:
        if (input.studentId !== undefined) {
          throw invalidProfile('학번은 학생만 저장할 수 있습니다.');
        }
        return null;
    }
  }

  buildProfileCompletion(
    user: UserProfileRecord,
    input: PatchUserProfileInput,
  ): CompleteUserProfileInput {
    if (input.staffNumber !== undefined) {
      throw invalidProfile('교직원 번호는 가입 완료 후 수정할 수 있습니다.');
    }
    const memberKind = user.selectedMemberKind ?? user.memberKind ?? null;
    if (memberKind === null) {
      throw invalidProfile('회원 유형을 먼저 선택해 주세요.');
    }
    const name = this.userProfileService.normalizeProfileText(input.name);
    if (!this.userProfileService.isValidUserName(name)) {
      throw invalidProfile('이름 형식이 올바르지 않습니다.');
    }
    const affiliation = this.resolveAffiliation(user, input);
    requireAllowedAffiliation(memberKind, affiliation.kind);
    const hasStaffAccess =
      memberKind === MemberKind.STAFF ? (user.hasStaffAccess ?? false) : false;

    return {
      name,
      studentId: this.completionStudentId(memberKind, user, input),
      department: affiliation.name,
      ...this.completionPhone(memberKind, user, input),
      memberKind,
      affiliationKind: affiliation.kind,
      affiliationName: affiliation.name,
      hasStaffAccess,
      hasAdminAccess: user.hasAdminAccess ?? false,
      requestsStaffAccess: memberKind === MemberKind.STAFF && !hasStaffAccess,
    };
  }
}
