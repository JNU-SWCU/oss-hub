import { MemberKind } from '@prisma/client';
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
  readonly role?: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
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

/** 아직 아무것도 채우지 않은 사용자. 역할만 갈아 끼운다. */
function emptyUser(role: 'STUDENT' | 'STAFF' | 'ADMIN' | null): StoredUser {
  const selectedMemberKind =
    role === 'STUDENT'
      ? MemberKind.STUDENT
      : role === 'STAFF'
        ? MemberKind.STAFF
        : null;
  return {
    id: 'synthetic-user',
    name: 'GitHub 합성 이름',
    studentId: null,
    department: null,
    role,
    selectedMemberKind,
    memberKind: selectedMemberKind,
    hasAdminAccess: role === 'ADMIN',
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

describe('역할별 필수 항목', () => {
  it('교직원은 학번 없이 이름·학과만으로 완료된다', async () => {
    // Given
    const { service, completeProfileIfUnchanged } = buildService({
      user: emptyUser('STAFF'),
    });

    // When
    const profile = await service.completeMyProfile(githubId, {
      name: input.name,
      department: input.department,
    });

    // Then
    expect(profile).toEqual({
      name: input.name,
      studentId: null,
      department: input.department,
      isComplete: true,
    });
    expect(completeProfileIfUnchanged).toHaveBeenCalledWith(expect.anything(), {
      name: input.name,
      studentId: null,
      department: input.department,
      memberKind: MemberKind.STAFF,
      affiliationKind: 'DEPARTMENT',
      affiliationName: input.department,
      hasStaffAccess: false,
      hasAdminAccess: false,
    });
  });

  it('교직원이 학과를 빠뜨리면 400 검증 오류로 거부한다', async () => {
    // Given
    const { service, completeProfileIfUnchanged } = buildService({
      user: emptyUser('STAFF'),
    });

    // When
    const error = await captureDomainException(() =>
      service.completeMyProfile(githubId, {
        name: input.name,
        department: '',
      }),
    );

    // Then
    expect(error.errorCode).toMatchObject({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
    });
    expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
  });

  /**
   * 형식이 좁아지기 전(#835)에 학번만 넣어 둔 학생 — 학과가 없어 아직 미완료다.
   *
   * 요청이 학번을 생략하면 저장돼 있던 값이 그대로 실린다. 그 값을 지금 형식으로
   * 다시 재면 학과 하나를 채우려는 저장이 400에 막히고, 학번은 바꿀 수 없어
   * 고칠 길이 없다. 형식은 **실려 온 값**에만 적용한다.
   */
  it('저장돼 있던 예전 형식 학번은 형식 검사 없이 완료 저장에 실린다', async () => {
    // Given
    const legacyStudentId = '9'.repeat(9);
    const { service, completeProfileIfUnchanged } = buildService({
      user: {
        ...emptyUser('STUDENT'),
        name: '합성 학생',
        studentId: legacyStudentId,
      },
    });

    // When
    const profile = await service.completeMyProfile(githubId, {
      name: input.name,
      department: input.department,
    });

    // Then
    expect(profile).toMatchObject({
      studentId: legacyStudentId,
      isComplete: true,
    });
    expect(completeProfileIfUnchanged).toHaveBeenCalledWith(expect.anything(), {
      name: input.name,
      studentId: legacyStudentId,
      department: input.department,
      memberKind: MemberKind.STUDENT,
      affiliationKind: 'DEPARTMENT',
      affiliationName: input.department,
      hasStaffAccess: false,
      hasAdminAccess: false,
    });
  });

  /** 예외는 저장된 값에만 준다 — 이번 요청에 실려 온 학번은 그대로 6자리를 본다. */
  it('요청에 실려 온 학번의 형식이 틀리면 400으로 거부한다', async () => {
    // Given
    const { service, completeProfileIfUnchanged } = buildService({
      user: emptyUser('STUDENT'),
    });

    // When
    const error = await captureDomainException(() =>
      service.completeMyProfile(githubId, {
        name: input.name,
        studentId: '9'.repeat(9),
        department: input.department,
      }),
    );

    // Then
    expect(error.errorCode).toMatchObject({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
    });
    expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
  });

  it('미분류 legacy 관리자는 회원 유형 추론 없이 완료를 거부한다', async () => {
    // Given
    const { service, completeProfileIfUnchanged } = buildService({
      user: { ...emptyUser('ADMIN'), name: null },
    });

    // When
    const error = await captureDomainException(() =>
      service.completeMyProfile(githubId, {
        name: input.name,
        department: input.department,
      }),
    );

    // Then
    expect(error.errorCode).toMatchObject({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
    });
    expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
  });
});
