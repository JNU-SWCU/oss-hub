import { MemberKind } from '@prisma/client';
import { DomainException } from '../common/error-code';
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

it('완료된 프로필은 이름·학과만 갱신한다', async () => {
  const { service, completeProfileIfUnchanged, updateProfileFields } =
    buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId,
        department: input.department ?? null,
        role: 'STUDENT',
      },
    });

  await expect(
    service.patchMyProfile(githubId, {
      name: '수정된 이름',
      department: '소프트웨어공학과',
    }),
  ).resolves.toEqual({
    name: '수정된 이름',
    studentId,
    department: '소프트웨어공학과',
    isComplete: true,
  });
  expect(updateProfileFields).toHaveBeenCalledWith('synthetic-user', {
    name: '수정된 이름',
    department: '소프트웨어공학과',
  });
  expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
});

it('동시 저장에서 선점에 실패하면 덮어쓰지 않고 409로 거부한다', async () => {
  const { service } = buildService({ completed: 'conflict' });

  const error = await captureDomainException(() =>
    service.completeMyProfile(githubId, input),
  );

  expect(error.errorCode.code).toBe(UsersErrorCode.PROFILE_ALREADY_COMPLETE);
});

it('완료된 프로필은 역할 선택 가능 상태로 확인한다', async () => {
  // Given
  const { service } = buildService({
    user: {
      id: 'synthetic-user',
      name: input.name,
      studentId,
      department: input.department ?? null,
      role: 'STUDENT',
    },
  });

  // When / Then
  await expect(
    service.requireCompleteProfile(githubId),
  ).resolves.toBeUndefined();
});

it.each([
  ['공백 이름', '   ', studentId, input.department ?? ''],
  ['빈 학번', input.name, '', input.department ?? ''],
  ['형식이 잘못된 학번', input.name, '12A456', input.department ?? ''],
  ['공백 학과', input.name, studentId, '   '],
] as const)(
  '%s 프로필은 역할 선택 가능 상태가 아닌 것으로 거부한다',
  async (_label, name, storedStudentId, department) => {
    // Given
    const { service } = buildService({
      user: {
        id: 'synthetic-user',
        name,
        studentId: storedStudentId,
        department,
        role: 'STUDENT',
      },
    });

    // When
    const error = await captureDomainException(() =>
      service.requireCompleteProfile(githubId),
    );

    // Then
    expect(error.errorCode).toMatchObject({ code: 'USR_002', status: 409 });
  },
);
