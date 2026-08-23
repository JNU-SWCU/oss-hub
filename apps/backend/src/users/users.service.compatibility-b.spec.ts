import { MemberKind } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { SystemErrorCode } from '../common/system-error-code.enum';
import type { PatchUserProfileInput } from './domain/user-profile';
import { UsersErrorCode } from './users-error-code.enum';
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

describe('기존 데이터 호환 후속', () => {
  it('학과가 빈 미완료 학생이 학번만 채워도 완료되지 않는다', async () => {
    const { service, completeProfileIfUnchanged } = buildService({
      user: { ...emptyUser('STUDENT'), name: null },
    });

    const error = await captureDomainException(() =>
      service.completeMyProfile(githubId, {
        name: input.name,
        studentId,
        department: '',
      }),
    );

    expect(error.errorCode).toMatchObject({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
    });
    expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
  });

  it('이미 학번이 있는 학생이 다른 값을 보내면 USR_003으로 거부한다', async () => {
    // Given — 한 번 정해진 학적 식별자는 사용자가 바꿀 수 없다
    const { service, updateProfileFields } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId,
        department: input.department ?? null,
        role: 'STUDENT',
      },
    });

    // When
    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, { ...input, studentId: '9'.repeat(6) }),
    );

    // Then
    expect(error.errorCode.code).toBe(UsersErrorCode.STUDENT_ID_IMMUTABLE);
    expect(updateProfileFields).not.toHaveBeenCalled();
  });

  it('이미 있는 학번과 같은 값을 다시 보내면 통과하고 학번은 건드리지 않는다', async () => {
    // Given — 폼이 현재 값을 그대로 싣는 정상 동작을 막지 않는다
    const { service, updateProfileFields } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId,
        department: input.department ?? null,
        role: 'STUDENT',
      },
    });

    // When
    const profile = await service.patchMyProfile(githubId, {
      ...input,
      name: '수정된 이름',
    });

    // Then
    expect(profile).toEqual({
      name: '수정된 이름',
      studentId,
      department: input.department,
      isComplete: true,
    });
    expect(updateProfileFields).toHaveBeenCalledWith('synthetic-user', {
      name: '수정된 이름',
      department: input.department,
    });
  });
});
