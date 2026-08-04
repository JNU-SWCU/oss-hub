import type { Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { SystemErrorCode } from '../common/system-error-code.enum';
import type { PatchUserProfileInput } from './domain/user-profile';
import { UsersErrorCode } from './users-error-code.enum';
import type { StudentIdFillOutcome, UsersRepositoryPort } from './users.store';
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
};

function buildService(
  overrides: {
    readonly user?: StoredUser | null;
    readonly completed?: boolean;
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
        }
      : overrides.user,
  );
  const completeProfileIfUnchanged = jest
    .fn()
    .mockResolvedValue(overrides.completed ?? true);
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
function emptyUser(role: Role | null): StoredUser {
  return {
    id: 'synthetic-user',
    name: 'GitHub 합성 이름',
    studentId: null,
    department: null,
    role,
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
      studentId,
      department: input.department ?? null,
      role: 'STUDENT',
    },
  });

  await expect(service.getMyProfile(githubId)).resolves.toEqual({
    name: '',
    studentId,
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
      role: null,
    },
    {
      name: input.name,
      studentId,
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

it('이미 완료된 프로필의 학번을 다른 값으로 바꾸려 하면 USR_003으로 거부한다', async () => {
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

  const error = await captureDomainException(() =>
    service.patchMyProfile(githubId, { ...input, studentId: '9'.repeat(8) }),
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

describe('역할별 필수 항목', () => {
  it('교직원은 학번 없이 이름·학과만으로 완료된다', async () => {
    // Given
    const { service, completeProfileIfUnchanged } = buildService({
      user: emptyUser('STAFF'),
    });

    // When
    const profile = await service.patchMyProfile(githubId, {
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
    });
  });

  it('교직원이 학과를 빠뜨리면 400 검증 오류로 거부한다', async () => {
    // Given
    const { service, completeProfileIfUnchanged } = buildService({
      user: emptyUser('STAFF'),
    });

    // When
    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, { name: input.name }),
    );

    // Then
    expect(error.errorCode).toMatchObject({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
    });
    expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
  });

  it('관리자는 이름만으로 완료된다', async () => {
    // Given — 이름조차 없는 관리자만 완료 저장 경로를 탄다
    const { service, completeProfileIfUnchanged } = buildService({
      user: { ...emptyUser('ADMIN'), name: null },
    });

    // When
    const profile = await service.patchMyProfile(githubId, {
      name: input.name,
    });

    // Then
    expect(profile).toEqual({
      name: input.name,
      studentId: null,
      department: null,
      isComplete: true,
    });
    expect(completeProfileIfUnchanged).toHaveBeenCalledWith(expect.anything(), {
      name: input.name,
      studentId: null,
      department: null,
    });
  });

  it('GitHub 이름이 실린 관리자는 온보딩 없이 이미 완료 상태다', async () => {
    // Given — 관리자에게 더 받을 항목이 없으므로 이름만으로 완료다
    const { service, updateProfileFields } = buildService({
      user: emptyUser('ADMIN'),
    });

    // When
    await expect(service.getMyProfile(githubId)).resolves.toMatchObject({
      isComplete: true,
    });
    await service.patchMyProfile(githubId, { name: input.name });

    // Then — 완료 상태이므로 1회 저장이 아니라 갱신 경로를 탄다
    expect(updateProfileFields).toHaveBeenCalledWith('synthetic-user', {
      name: input.name,
    });
  });

  it('학생은 학번과 학과가 모두 있어야 완료된다', async () => {
    // Given
    const { service } = buildService({ user: emptyUser('STUDENT') });

    // When
    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, {
        name: input.name,
        department: input.department,
      }),
    );

    // Then
    expect(error.errorCode).toMatchObject({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
    });
  });

  it('역할이 없는 사용자는 학생 기준으로 학번까지 요구한다', async () => {
    // Given — 온보딩 중에는 role이 null이고, 자력으로 고를 수 있는 역할은 학생뿐이다
    const { service } = buildService({ user: emptyUser(null) });

    // When
    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, {
        name: input.name,
        department: input.department,
      }),
    );

    // Then
    expect(error.errorCode).toMatchObject({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
    });
  });

  it('역할을 조회하지 않은 기록도 학생 기준으로 판정한다', async () => {
    // Given — roles 모듈은 role을 select하지 않고 UserProfileRecord를 만든다
    const { service } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: null,
        department: input.department ?? null,
      },
    });

    // When
    const error = await captureDomainException(() =>
      service.requireCompleteProfile(githubId),
    );

    // Then
    expect(error.errorCode).toMatchObject({ code: 'USR_002', status: 409 });
  });
});

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

  it('학과를 생략한 관리자 갱신은 기존 학과를 지우지 않는다', async () => {
    // Given
    const { service, updateProfileFields } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: null,
        department: input.department ?? null,
        role: 'ADMIN',
      },
    });

    // When
    const profile = await service.patchMyProfile(githubId, {
      name: '수정된 이름',
    });

    // Then
    expect(profile.department).toBe(input.department);
    expect(updateProfileFields).toHaveBeenCalledWith('synthetic-user', {
      name: '수정된 이름',
    });
  });

  it('학번이 비어 있던 완료 교직원은 학번을 처음 한 번 채울 수 있다', async () => {
    // Given — 조교처럼 대학원생 신분을 겸하는 교직원은 학번이 실제로 있다.
    // 이 사용자는 학번 없이 완료돼 UserProfile 행이 아직 없다.
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
    const profile = await service.patchMyProfile(githubId, input);

    // Then — 학번은 유일성 제약이 걸린 UserProfile 행을 만드는 경로로만 저장된다.
    // 이름·학과 갱신 경로로 흘려보내면 `updateMany`가 0행을 갱신하고 제약 없는
    // 구버전 User 컬럼에만 남아, 두 사람이 같은 학번을 가질 수 있었다.
    expect(profile).toEqual({ ...input, isComplete: true });
    expect(fillStudentId).toHaveBeenCalledWith(stored, {
      name: input.name,
      studentId,
      department: input.department,
    });
    expect(updateProfileFields).not.toHaveBeenCalled();
  });

  it('다른 계정이 이미 쓰는 학번이면 USR_004로 거부한다', async () => {
    // Given — 재시도해도 결과가 같은 실패다
    const { service } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: null,
        department: input.department ?? null,
        role: 'STAFF',
      },
      studentIdFill: 'taken',
    });

    // When
    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, input),
    );

    // Then
    expect(error.errorCode).toMatchObject({
      code: UsersErrorCode.STUDENT_ID_TAKEN,
      status: 409,
    });
  });

  it('같은 계정의 학번을 다른 요청이 먼저 채웠으면 USR_003으로 거부한다', async () => {
    // Given — 최초 저장 두 건이 경쟁하면 한 건만 성공해야 한다
    const { service } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: null,
        department: input.department ?? null,
        role: 'STAFF',
      },
      studentIdFill: 'conflict',
    });

    // When
    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, input),
    );

    // Then
    expect(error.errorCode.code).toBe(UsersErrorCode.STUDENT_ID_IMMUTABLE);
  });

  it('학과 없는 완료 관리자가 학번만 보내면 USR_005로 거부한다', async () => {
    // Given — 학번을 유일하게 지킬 수 있는 자리는 학과를 요구하는 UserProfile 행뿐이다
    const { service, fillStudentId, updateProfileFields } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: null,
        department: null,
        role: 'ADMIN',
      },
    });

    // When
    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, { name: input.name, studentId }),
    );

    // Then
    expect(error.errorCode).toMatchObject({
      code: UsersErrorCode.STUDENT_ID_NEEDS_DEPARTMENT,
      status: 400,
    });
    expect(fillStudentId).not.toHaveBeenCalled();
    expect(updateProfileFields).not.toHaveBeenCalled();
  });

  it('학과 없는 미완료 관리자가 학번만 보내도 USR_005로 거부한다', async () => {
    // Given — 1회 완료 저장도 같은 이유로 학번만 따로 남길 수 없다
    const { service, completeProfileIfUnchanged } = buildService({
      user: { ...emptyUser('ADMIN'), name: null },
    });

    // When
    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, { name: input.name, studentId }),
    );

    // Then
    expect(error.errorCode).toMatchObject({
      code: UsersErrorCode.STUDENT_ID_NEEDS_DEPARTMENT,
      status: 400,
    });
    expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
  });

  it('처음 채우는 학번의 형식이 틀리면 400 검증 오류로 거부한다', async () => {
    // Given
    const { service, updateProfileFields } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: null,
        department: input.department ?? null,
        role: 'STAFF',
      },
    });

    // When
    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, { ...input, studentId: '12A456' }),
    );

    // Then
    expect(error.errorCode).toMatchObject({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
    });
    expect(updateProfileFields).not.toHaveBeenCalled();
  });

  it('이미 학번이 있는 교직원이 다른 값을 보내면 USR_003으로 거부한다', async () => {
    // Given — 한 번 정해진 학적 식별자는 사용자가 바꿀 수 없다
    const { service, updateProfileFields } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId,
        department: input.department ?? null,
        role: 'STAFF',
      },
    });

    // When
    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, { ...input, studentId: '9'.repeat(8) }),
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
        role: 'STAFF',
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

describe('역할 변경 경계', () => {
  it('학생이 교직원이 되어도 학번은 남고 프로필은 완료로 유지된다', async () => {
    // Given
    const { service } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId,
        department: input.department ?? null,
        role: 'STAFF',
      },
    });

    // When / Then
    await expect(service.getMyProfile(githubId)).resolves.toEqual({
      name: input.name,
      studentId,
      department: input.department,
      isComplete: true,
    });
    await expect(
      service.requireCompleteProfile(githubId),
    ).resolves.toBeUndefined();
  });

  it('학번 없는 교직원이 학생으로 바뀌면 미완료가 되고 학번을 다시 받는다', async () => {
    // Given
    const { service, completeProfileIfUnchanged } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: null,
        department: input.department ?? null,
        role: 'STUDENT',
      },
    });

    // When
    await expect(service.getMyProfile(githubId)).resolves.toMatchObject({
      isComplete: false,
    });
    const profile = await service.patchMyProfile(githubId, input);

    // Then — 학번이 아직 없었으므로 USR_003이 아니라 최초 저장으로 처리한다
    expect(profile).toEqual({ ...input, isComplete: true });
    expect(completeProfileIfUnchanged).toHaveBeenCalledWith(expect.anything(), {
      name: input.name,
      studentId,
      department: input.department,
    });
  });

  it('이름만 있는 관리자가 교직원이 되면 학과만 추가로 받는다', async () => {
    // Given
    const { service, completeProfileIfUnchanged } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: null,
        department: null,
        role: 'STAFF',
      },
    });

    // When
    await expect(service.getMyProfile(githubId)).resolves.toMatchObject({
      isComplete: false,
    });
    const profile = await service.patchMyProfile(githubId, {
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
    });
  });
});
