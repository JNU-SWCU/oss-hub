import { MemberKind, Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { SystemErrorCode } from '../common/system-error-code.enum';
import type { PatchUserProfileInput } from './domain/user-profile';
import type {
  ProfileCompletionOutcome,
  StudentIdFillOutcome,
  UsersRepositoryPort,
} from './users.repository';
import { UsersService } from './users.service';

const githubId = 4242n;
const studentId = '1'.repeat(6);
const input: PatchUserProfileInput = {
  name: '합성 사용자',
  studentId,
  department: '인공지능학부',
};

type StoredUser = {
  readonly id: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly role?: Role | null;
  readonly selectedMemberKind?: MemberKind | null;
  readonly memberKind?: MemberKind | null;
  readonly hasAdminAccess?: boolean;
};

function buildService(
  overrides: {
    readonly user?: StoredUser | null;
    readonly completed?: ProfileCompletionOutcome;
    readonly studentIdFill?: StudentIdFillOutcome;
    readonly consentError?: Error;
  } = {},
) {
  const requireCurrent = overrides.consentError
    ? jest.fn().mockRejectedValue(overrides.consentError)
    : jest.fn().mockResolvedValue(undefined);
  const findByGithubId = jest.fn().mockResolvedValue(
    overrides.user === undefined
      ? {
          id: 'synthetic-user',
          name: 'GitHub 합성 이름',
          studentId: null,
          department: null,
          role: null,
          selectedMemberKind: MemberKind.STUDENT,
          memberKind: null,
          hasAdminAccess: false,
        }
      : overrides.user,
  );
  const completeProfileIfUnchanged = jest
    .fn()
    .mockResolvedValue(overrides.completed ?? 'completed');
  const updateProfileFields = jest.fn().mockResolvedValue(undefined);
  const fillStudentId = jest
    .fn()
    .mockResolvedValue(overrides.studentIdFill ?? 'filled');
  const repository: UsersRepositoryPort = {
    findByGithubId,
    completeProfileIfUnchanged,
    fillStudentId,
    updateProfileFields,
  };
  return {
    service: new UsersService(repository, { requireCurrent }),
    requireCurrent,
    findByGithubId,
    completeProfileIfUnchanged,
    fillStudentId,
    updateProfileFields,
  };
}

async function captureDomainException(
  operation: () => Promise<unknown>,
): Promise<DomainException> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof DomainException) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected DomainException');
}

describe('기존 데이터 호환', () => {
  it('세 항목을 모두 채운 기존 사용자는 어떤 역할에서도 완료다', async () => {
    for (const role of ['STUDENT', 'STAFF', 'ADMIN', null] as const) {
      // Given
      const { service } = buildService({
        user: {
          id: 'synthetic-user',
          name: input.name,
          studentId,
          department: input.department ?? null,
          role,
        },
      });

      // When / Then
      await expect(service.getMyProfile(githubId)).resolves.toMatchObject({
        studentId,
        isComplete: true,
      });
    }
  });

  it('학번이 null인 기존 교직원은 학번을 요구받지 않고 이름·학과만 갱신한다', async () => {
    // Given
    const { service, updateProfileFields, completeProfileIfUnchanged } =
      buildService({
        user: {
          id: 'synthetic-user',
          name: input.name,
          studentId: null,
          department: input.department ?? null,
          role: 'STAFF',
        },
      });

    // When
    const profile = await service.patchMyProfile(githubId, {
      name: '수정된 이름',
      department: '소프트웨어공학과',
    });

    // Then
    expect(profile).toEqual({
      name: '수정된 이름',
      studentId: null,
      department: '소프트웨어공학과',
      isComplete: true,
    });
    expect(updateProfileFields).toHaveBeenCalledWith('synthetic-user', {
      name: '수정된 이름',
      department: '소프트웨어공학과',
    });
    expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
  });

  it('관리자 갱신도 이름·학과를 함께 보낸다', async () => {
    const { service, updateProfileFields } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: null,
        department: input.department ?? null,
        role: 'ADMIN',
      },
    });

    const profile = await service.patchMyProfile(githubId, {
      name: '수정된 이름',
      department: input.department,
    });

    expect(profile.department).toBe(input.department);
    expect(updateProfileFields).toHaveBeenCalledWith('synthetic-user', {
      name: '수정된 이름',
      department: input.department,
    });
  });

  it('교직원이 학번을 실어 보내면 400 검증 오류로 거부한다', async () => {
    // Given — 학번은 학생만 가질 수 있다. 조교처럼 대학원생 신분을 겸하는
    // 교직원이라도 이제는 학번을 채울 수 없다(예전에는 완료된 교직원이 학번을
    // 한 번 채울 수 있었지만, 그 예외를 없앴다).
    const stored = {
      id: 'synthetic-user',
      name: input.name,
      studentId: null,
      department: input.department ?? null,
      role: 'STAFF',
    } as const;
    const { service, updateProfileFields, fillStudentId } = buildService({
      user: stored,
    });

    // When
    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, input),
    );

    // Then
    expect(error.errorCode).toMatchObject({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
    });
    expect(fillStudentId).not.toHaveBeenCalled();
    expect(updateProfileFields).not.toHaveBeenCalled();
  });
});
