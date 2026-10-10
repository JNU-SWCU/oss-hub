import { MemberKind } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import type { PatchUserProfileInput } from '../domain/user-profile';
import { UsersErrorCode } from '../domain/users-error-code.enum';
import type {
  ProfileCompletionOutcome,
  UsersRepositoryPort,
} from '../repository/users.repository';
import { UsersService } from './users.service';

type StudentIdFillOutcome = Awaited<
  ReturnType<UsersRepositoryPort['fillStudentId']>
>;

const githubId = 4242n;
const studentId = '1'.repeat(6);
const input: PatchUserProfileInput = {
  name: '합성 사용자',
  studentId,
  department: '인공지능학부',
  phone: '7'.repeat(10),
};

type StoredUser = {
  readonly id: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly staffNumber?: string | null;
  readonly department: string | null;
  readonly phone?: string | null;
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
          staffNumber: null,
          department: null,
          phone: null,
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
  const updateProfileFields = jest
    .fn<Promise<void>, Parameters<UsersRepositoryPort['updateProfileFields']>>()
    .mockResolvedValue(undefined);
  const fillStudentId = jest
    .fn()
    .mockResolvedValue(overrides.studentIdFill ?? 'filled');
  const repository: UsersRepositoryPort = {
    findByGithubId,
    completeProfileIfUnchanged,
    fillStudentId,
    updateProfileFields,
  };
  const record = jest.fn().mockResolvedValue(undefined);
  return {
    service: new UsersService(repository, { requireCurrent }, { record }),
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
  const existingUser = {
    id: 'synthetic-user',
    name: input.name,
    studentId,
    staffNumber: null,
    department: input.department ?? null,
    phone: null,
    role: 'STUDENT' as const,
  };
  const { service, completeProfileIfUnchanged, updateProfileFields } =
    buildService({
      user: existingUser,
    });

  await expect(
    service.patchMyProfile(githubId, {
      name: '수정된 이름',
      department: '소프트웨어공학과',
    }),
  ).resolves.toEqual({
    name: '수정된 이름',
    studentId,
    staffNumber: null,
    department: '소프트웨어공학과',
    phone: null,
    isComplete: true,
  });
  expect(updateProfileFields).toHaveBeenCalledWith(
    existingUser,
    {
      name: '수정된 이름',
      department: '소프트웨어공학과',
    },
    expect.any(Function),
    expect.any(Function),
  );
  expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
});

describe('본인 교직원 번호 수정', () => {
  const staff: StoredUser = {
    id: 'synthetic-staff',
    name: '합성 교직원',
    studentId,
    staffNumber: 'OLD-42',
    department: '인공지능학부',
    phone: null,
    role: 'ADMIN',
    memberKind: MemberKind.STAFF,
    selectedMemberKind: MemberKind.STAFF,
    hasAdminAccess: true,
  };
  const profileInput = {
    name: '합성 교직원',
    department: '인공지능학부',
  };

  it.each([
    [' É-42 ', 'É-42'],
    [null, null],
    [undefined, 'OLD-42'],
  ])('사번 %s 입력을 정규화·삭제·보존한다', async (staffNumber, expected) => {
    const { service, updateProfileFields } = buildService({ user: staff });
    const result = await service.patchMyProfile(githubId, {
      ...profileInput,
      ...(staffNumber === undefined ? {} : { staffNumber }),
    });
    expect(result).toMatchObject({ staffNumber: expected, studentId });
    expect(updateProfileFields).toHaveBeenCalledTimes(1);
    const fields = updateProfileFields.mock.calls[0]?.[1];
    if (staffNumber === undefined) {
      expect(fields).not.toHaveProperty('staffNumber');
    } else {
      expect(fields).toHaveProperty('staffNumber', expected);
    }
  });

  it('학생 관리자는 사번을 수정할 수 없다', async () => {
    const { service, updateProfileFields } = buildService({
      user: { ...staff, memberKind: MemberKind.STUDENT },
    });
    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, { ...profileInput, staffNumber: 'NEW' }),
    );
    expect(error.errorCode.status).toBe(400);
    expect(updateProfileFields).not.toHaveBeenCalled();
  });

  it('가입 완료 요청의 사번을 조용히 버리지 않고 거절한다', async () => {
    const { service, completeProfileIfUnchanged } = buildService();
    const error = await captureDomainException(() =>
      service.completeMyProfile(githubId, { ...input, staffNumber: 'NEW' }),
    );
    expect(error.errorCode.status).toBe(400);
    expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
  });
});

it('동시 저장에서 선점에 실패하면 덮어쓰지 않고 409로 거부한다', async () => {
  const { service } = buildService({ completed: 'conflict' });

  const error = await captureDomainException(() =>
    service.completeMyProfile(githubId, input),
  );

  expect(error.errorCode.code).toBe(UsersErrorCode.PROFILE_ALREADY_COMPLETE);
});

it('완료된 프로필은 역할 선택 가능 상태로 확인한다', async () => {
  const { service } = buildService({
    user: {
      id: 'synthetic-user',
      name: input.name,
      studentId,
      department: input.department ?? null,
      role: 'STUDENT',
    },
  });

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
    const { service } = buildService({
      user: {
        id: 'synthetic-user',
        name,
        studentId: storedStudentId,
        department,
        role: 'STUDENT',
      },
    });

    const error = await captureDomainException(() =>
      service.requireCompleteProfile(githubId),
    );

    expect(error.errorCode).toMatchObject({ code: 'USR_002', status: 409 });
  },
);
