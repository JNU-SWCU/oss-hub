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
  isCompleteUserProfile,
  isValidDepartment,
  isValidStudentId,
  profileFieldRequirement,
  toUserProfile,
} from './domain/user-profile';
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
   * 미완료: 역할이 요구하는 항목이 모두 있어야 1회 완료 저장.
   * 완료: 이름·학과만 갱신. studentId가 본문에 있으면 USR_003.
   *
   * "완료"의 기준이 역할마다 달라졌다(#439). 그래서 학번 불변 규칙도 역할을 따라
   * 움직인다 — 학번 없이 완료된 교직원이 학생으로 강등되면 프로필이 다시 미완료가
   * 되고, 그때는 학번을 처음 채워 넣을 수 있다.
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
      name: input.name,
      studentId: input.studentId ?? user.studentId,
      department: input.department ?? user.department,
    };

    if (isCompleteUserProfile(user)) {
      if (input.studentId !== undefined) {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_IMMUTABLE],
        );
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

  /** 역할이 요구하는 항목이 비었거나 형식이 깨졌으면 400으로 멈춘다. */
  private requireFieldsForRole(next: UserProfileRecord): void {
    const requirement = profileFieldRequirement(next.role);
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
