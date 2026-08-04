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
  isValidDepartment,
  isValidStudentId,
  profileFieldRequirement,
  toUserProfile,
} from './domain/user-profile';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.enum';
import { UsersStore } from './users.store';
import type { UsersRepositoryPort } from './users.store';

@Injectable()
export class UsersService {
  constructor(
    @Inject(UsersStore)
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
   * 미완료: 역할이 요구하는 항목이 모두 있어야 1회 완료 저장.
   * 완료: 이름·학과 갱신. 학번은 **아직 없을 때만** 처음 한 번 채울 수 있고,
   * 이미 값이 있으면 바꿀 수 없다(USR_003).
   *
   * "완료"의 기준이 역할마다 달라졌다(#439). 그래서 학번 불변 규칙도 역할을 따라
   * 움직인다 — 학번 없이 완료된 교직원이 학생으로 강등되면 프로필이 다시 미완료가
   * 되고, 그때는 학번을 처음 채워 넣을 수 있다.
   *
   * 학번을 요구하지 않는 역할에게도 학번은 **선택 항목으로 열어 둔다**. 조교처럼
   * 대학원생 신분을 겸하는 교직원은 학번이 실제로 있고, 그 값을 남기고 싶어 한다.
   * 없으면 비워 두면 되고, 한 번 넣으면 학적 식별자로서 고정된다.
   *
   * **미완료 → 완료 저장이 곧 `가입 마치기`다(#569).** 그 순간 고른 역할이 확정된다 —
   * 학생은 역할이 배정되고 교직원은 승인 요청이 만들어진다. 확정을 저장과 같은
   * 트랜잭션에 묶는 일은 저장소가 한다(`completeProfileIfUnchanged`).
   */
  async patchMyProfile(
    githubId: bigint,
    input: PatchUserProfileInput,
  ): Promise<UserProfile> {
    await this.consentsService.requireCurrent(githubId);
    const user = await this.requireUser(githubId);
    const next: UserProfileRecord = {
      id: user.id,
      role: user.role,
      // 확정 전에는 이 값이 필수 항목을 정하는 유일한 근거다(#569). 빠뜨리면 교직원이
      // 학생 기준으로 판정돼, 학번 없이 마친 프로필이 미완료로 되돌아간다.
      selectedRole: user.selectedRole,
      hasPendingStaffRequest: user.hasPendingStaffRequest,
      name: input.name,
      studentId: input.studentId ?? user.studentId,
      department: input.department ?? user.department,
    };

    if (isCompleteUserProfile(user)) {
      // 이미 값이 있는데 다른 값을 보내면 거부한다. 같은 값을 다시 보내는 것은
      // 폼이 현재 값을 그대로 싣는 정상 동작이라 통과시킨다.
      const changesExistingStudentId =
        input.studentId !== undefined &&
        user.studentId !== null &&
        input.studentId !== user.studentId;
      if (changesExistingStudentId) {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_IMMUTABLE],
        );
      }
      // 비어 있던 학번을 처음 채우는 경우 — 형식은 확인한다.
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
          { name: input.name, department: next.department },
          input.studentId,
        );
        return toUserProfile(next);
      }
      await this.repository.updateProfileFields(user.id, {
        name: input.name,
        ...(input.department === undefined
          ? {}
          : { department: input.department }),
      });
      return toUserProfile(next);
    }

    this.requireFieldsForRole(next);
    const completed = await this.repository.completeProfileIfUnchanged(user, {
      name: input.name,
      studentId: next.studentId,
      department: next.department,
    });
    if (!completed) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.PROFILE_ALREADY_COMPLETE],
      );
    }
    return toUserProfile(next);
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

  /**
   * 역할이 요구하는 항목이 비었거나 형식이 깨졌으면 400으로 멈춘다.
   *
   * 역할이 학과를 요구하지 않아도 **학번을 함께 저장하려면 학과가 필요하다**. 학번의
   * 유일성을 보증하는 곳은 UserProfile 행의 unique 제약뿐이고 그 행은 학과를 NOT NULL로
   * 요구하기 때문이다. 학과 없이 학번만 받으면 제약이 없는 구버전 `User.studentId`
   * 컬럼에만 남아 서로 다른 두 사람이 같은 학번을 갖게 된다.
   */
  private requireFieldsForRole(next: UserProfileRecord): void {
    const requirement = profileFieldRequirement(effectiveProfileRole(next));
    if (next.studentId !== null && next.department === null) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_NEEDS_DEPARTMENT],
      );
    }
    if (
      requirement.studentId &&
      (next.studentId === null || !isValidStudentId(next.studentId))
    ) {
      throw new DomainException({
        code: SystemErrorCode.VALIDATION_FAILED,
        status: 400,
        message: '온보딩 프로필 완료에는 학번이 필요합니다.',
      });
    }
    if (
      requirement.department &&
      (next.department === null || !isValidDepartment(next.department))
    ) {
      throw new DomainException({
        code: SystemErrorCode.VALIDATION_FAILED,
        status: 400,
        message: '온보딩 프로필 완료에는 학과가 필요합니다.',
      });
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
