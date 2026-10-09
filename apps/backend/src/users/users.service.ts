import { Inject, Injectable } from '@nestjs/common';
import {
  AUTH_ERROR_CODES,
  AuthErrorCode,
} from '../auth/domain/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import { SystemErrorCode } from '../common/system-error-code.enum';
import { ConsentsService } from '../consents/consents.service';
import type {
  PatchUserProfileInput,
  UserProfile,
  UserProfileRecord,
} from './domain/user-profile';
import {
  effectiveProfileMemberKind,
  isCompleteUserProfile,
  isValidStudentId,
  nextProfileRecord,
  profileFieldRequirement,
  toUserProfile,
} from './domain/user-profile';
import {
  buildProfileCompletion,
  buildProfileUpdate,
} from './member-profile-completion';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.enum';
import { UsersRepository } from './users.repository';
import type { UsersRepositoryPort } from './users.repository';

@Injectable()
export class UsersService {
  constructor(
    @Inject(UsersRepository)
    private readonly repository: UsersRepositoryPort,
    @Inject(ConsentsService)
    private readonly consentsService: Pick<ConsentsService, 'requireCurrent'>,
  ) {}

  async getMyProfile(githubId: bigint): Promise<UserProfile> {
    await this.consentsService.requireCurrent(githubId);
    return toUserProfile(await this.requireUser(githubId));
  }

  async requireCompleteProfile(githubId: bigint): Promise<void> {
    const profile = toUserProfile(await this.requireUser(githubId));
    if (!profile.isComplete) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.PROFILE_INCOMPLETE],
      );
    }
  }

  async completeMyProfile(
    githubId: bigint,
    input: PatchUserProfileInput,
  ): Promise<UserProfile> {
    const user = await this.requireWritableUser(githubId, input);
    if (isCompleteUserProfile(user)) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.PROFILE_ALREADY_COMPLETE],
      );
    }
    const completion = buildProfileCompletion(user, input);
    const outcome = await this.repository.completeProfileIfUnchanged(
      user,
      completion,
    );
    switch (outcome) {
      case 'completed':
        return toUserProfile(nextProfileRecord(user, completion));
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
    if (!isCompleteUserProfile(user)) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.PROFILE_COMPLETE_REQUIRES_POST],
      );
    }
    const fields = buildProfileUpdate(user, input);
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
    if (fillsStudentId && !isValidStudentId(input.studentId)) {
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
      return toUserProfile(next);
    }
    await this.repository.updateProfileFields(user, fields);
    return toUserProfile(next);
  }

  private async requireWritableUser(
    githubId: bigint,
    input: PatchUserProfileInput,
  ): Promise<UserProfileRecord> {
    await this.consentsService.requireCurrent(githubId);
    const user = await this.requireUser(githubId);
    if (
      input.studentId !== undefined &&
      !profileFieldRequirement(effectiveProfileMemberKind(user)).studentId
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
    const outcome = await this.repository.fillStudentId({
      expected: user,
      studentId,
      ...(next.phone === undefined ? {} : { phone: next.phone }),
    });
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

  private async requireUser(githubId: bigint): Promise<UserProfileRecord> {
    const user = await this.repository.findByGithubId(githubId);
    if (!user) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    return user;
  }
}
