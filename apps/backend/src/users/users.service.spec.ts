import { DomainException } from '../common/error-code';
import { SystemErrorCode } from '../common/system-error-code.enum';
import type { PatchUserProfileInput } from './domain/user-profile';
import { UsersErrorCode } from './users-error-code.enum';
import type { UsersRepositoryPort } from './users.repository';
import { UsersService } from './users.service';

const githubId = 4242n;
const input: PatchUserProfileInput = {
  name: '합성 사용자',
  studentId: '1'.repeat(6),
  department: '인공지능학부',
};

function buildService(
  overrides: {
    readonly user?: {
      readonly id: string;
      readonly name: string | null;
      readonly studentId: string | null;
      readonly department: string | null;
    } | null;
    readonly completed?: boolean;
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
        }
      : overrides.user,
  );
  const completeProfileIfUnchanged = jest
    .fn()
    .mockResolvedValue(overrides.completed ?? true);
  const updateProfileFields = jest.fn().mockResolvedValue(undefined);
  const repository: UsersRepositoryPort = {
    findByGithubId,
    completeProfileIfUnchanged,
    updateProfileFields,
  };
  return {
    service: new UsersService(repository, { requireCurrent }),
    requireCurrent,
    findByGithubId,
    completeProfileIfUnchanged,
    updateProfileFields,
  };
}

async function captureDomainException(
  operation: () => Promise<unknown>,
): Promise<DomainException> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainException);
    return error as DomainException;
  }
  throw new Error('Expected DomainException');
}

it('현행 동의를 확인한 뒤 GitHub 이름과 빈 프로필을 반환한다', async () => {
  const { service, requireCurrent } = buildService();

  await expect(service.getMyProfile(githubId)).resolves.toEqual({
    name: 'GitHub 합성 이름',
    studentId: null,
    department: null,
    isComplete: false,
  });
  expect(requireCurrent).toHaveBeenCalledWith(githubId);
});

it('이름이 비어 있으면 학번과 학과가 있어도 미완료로 반환한다', async () => {
  const { service } = buildService({
    user: {
      id: 'synthetic-user',
      name: '',
      studentId: input.studentId ?? null,
      department: input.department,
    },
  });

  await expect(service.getMyProfile(githubId)).resolves.toEqual({
    name: '',
    studentId: input.studentId,
    department: input.department,
    isComplete: false,
  });
});

it('동의 확인이 실패하면 사용자 조회를 시작하지 않는다', async () => {
  const consentError = new Error('synthetic consent failure');
  const { service, findByGithubId } = buildService({ consentError });

  await expect(service.getMyProfile(githubId)).rejects.toBe(consentError);
  expect(findByGithubId).not.toHaveBeenCalled();
});

it('빈 프로필을 한 번만 저장하고 완료 응답을 반환한다', async () => {
  const { service, completeProfileIfUnchanged, updateProfileFields } =
    buildService();

  await expect(service.patchMyProfile(githubId, input)).resolves.toEqual({
    ...input,
    isComplete: true,
  });
  expect(completeProfileIfUnchanged).toHaveBeenCalledWith(
    {
      id: 'synthetic-user',
      name: 'GitHub 합성 이름',
      studentId: null,
      department: null,
    },
    {
      name: input.name,
      studentId: input.studentId,
      department: input.department,
    },
  );
  expect(updateProfileFields).not.toHaveBeenCalled();
});

it('미완료 프로필에 학번이 없으면 400 검증 오류로 거부한다', async () => {
  const { service, completeProfileIfUnchanged, updateProfileFields } =
    buildService();

  const error = await captureDomainException(() =>
    service.patchMyProfile(githubId, {
      name: input.name,
      department: input.department,
    }),
  );

  expect(error.errorCode).toMatchObject({
    code: SystemErrorCode.VALIDATION_FAILED,
    status: 400,
  });
  expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
  expect(updateProfileFields).not.toHaveBeenCalled();
});

it('이미 완료된 프로필에 학번을 보내면 USR_003으로 거부한다', async () => {
  const { service, completeProfileIfUnchanged, updateProfileFields } =
    buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: input.studentId ?? null,
        department: input.department,
      },
    });

  const error = await captureDomainException(() =>
    service.patchMyProfile(githubId, input),
  );

  expect(error.errorCode.code).toBe(UsersErrorCode.STUDENT_ID_IMMUTABLE);
  expect(error.errorCode.status).toBe(400);
  expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
  expect(updateProfileFields).not.toHaveBeenCalled();
});

it('완료된 프로필은 이름·학과만 갱신한다', async () => {
  const { service, completeProfileIfUnchanged, updateProfileFields } =
    buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: input.studentId ?? null,
        department: input.department,
      },
    });

  await expect(
    service.patchMyProfile(githubId, {
      name: '수정된 이름',
      department: '소프트웨어공학과',
    }),
  ).resolves.toEqual({
    name: '수정된 이름',
    studentId: input.studentId,
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
  const { service } = buildService({ completed: false });

  const error = await captureDomainException(() =>
    service.patchMyProfile(githubId, input),
  );

  expect(error.errorCode.code).toBe(UsersErrorCode.PROFILE_ALREADY_COMPLETE);
});

it('완료된 프로필은 역할 선택 가능 상태로 확인한다', async () => {
  // Given
  const { service } = buildService({
    user: {
      id: 'synthetic-user',
      name: input.name,
      studentId: input.studentId ?? null,
      department: input.department,
    },
  });

  // When / Then
  await expect(
    service.requireCompleteProfile(githubId),
  ).resolves.toBeUndefined();
});

it.each([
  ['공백 이름', '   ', input.studentId ?? '', input.department],
  ['빈 학번', input.name, '', input.department],
  ['형식이 잘못된 학번', input.name, '12A456', input.department],
  ['공백 학과', input.name, input.studentId ?? '', '   '],
] as const)(
  '%s 프로필은 역할 선택 가능 상태가 아닌 것으로 거부한다',
  async (_label, name, studentId, department) => {
    // Given
    const { service } = buildService({
      user: {
        id: 'synthetic-user',
        name,
        studentId,
        department,
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
