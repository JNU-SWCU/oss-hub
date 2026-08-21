import { Inject, Injectable } from '@nestjs/common';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import { SystemErrorCode } from '../common/system-error-code.enum';
import { ConsentsService } from '../consents/consents.service';
import type {
  PatchUserProfileInput,
  UserProfile,
  UserProfileRecord,
} from './domain/user-profile';
import {
  effectiveProfileRole,
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

  /**
   * 가입 마치기 — 미완료 프로필을 이름·학과(학생은 학번)와 함께 한 번에 완료한다.
   *
   * **미완료 → 완료 저장이 곧 `가입 마치기`다(#569).** 그 순간 고른 역할이 확정된다 —
   * 학생은 역할이 배정되고 교직원은 승인 요청이 만들어진다. 확정을 저장과 같은
   * 트랜잭션에 묶는 일은 저장소가 한다(`completeProfileIfUnchanged`).
   *
   * 이미 완료된 프로필은 USR_001. 부분 수정(PATCH)으로는 이 경로에 들어오지 못한다.
   */
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

  /**
   * 완료된 프로필의 이름·학과 갱신. 학번은 **아직 없을 때만** 처음 한 번 채울 수
   * 있고, 이미 값이 있으면 바꿀 수 없다(USR_003).
   *
   * 미완료 프로필은 PATCH로 완료하지 않는다 — 스크립트가 이름만 보내 학과를
   * null로 남기던 구멍이다. 가입은 `completeMyProfile`(POST)만 받는다.
   */
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
        },
        input.studentId,
      );
      return toUserProfile(next);
    }
    await this.repository.updateProfileFields(user.id, fields);
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
      !profileFieldRequirement(effectiveProfileRole(user)).studentId
    ) {
      throw new DomainException({
        code: SystemErrorCode.VALIDATION_FAILED,
        status: 400,
        message: '학번은 학생만 저장할 수 있습니다.',
      });
    }
    return user;
  }

  /**
   * 비어 있던 학번을 처음 채운다 — 유일성 제약이 걸린 UserProfile 행을 만드는 경로다.
   *
   * 예전에는 이름·학과와 같은 갱신 경로로 흘려보냈고, UserProfile 행이 없는 사용자
   * (학번 없이 완료된 교직원)에게는 `updateMany`가 0행을 갱신한 뒤 제약이 없는 구버전
   * `User.studentId` 컬럼에만 값이 남았다. 그래서 서로 다른 두 사람이 같은 학번을 가질 수
   * 있었고, 한 사람의 동시 최초 저장 두 건이 모두 성공했다.
   */
  private async fillStudentId(
    user: UserProfileRecord,
    next: { readonly name: string; readonly department: string | null },
    studentId: string,
  ): Promise<void> {
    if (next.department === null) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_NEEDS_DEPARTMENT],
      );
    }
    const outcome = await this.repository.fillStudentId(user, {
      name: next.name,
      studentId,
      department: next.department,
    });
    switch (outcome) {
      case 'filled':
        return;
      case 'taken':
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_TAKEN],
        );
      case 'conflict':
        // 같은 계정을 다른 요청이 먼저 바꿨다. 학번은 이미 정해졌을 가능성이 높으므로
        // 불변 규칙과 같은 답을 준다 — 다시 읽으면 현재 값이 보인다.
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
