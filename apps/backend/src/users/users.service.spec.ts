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

  await expect(service.completeMyProfile(githubId, input)).resolves.toEqual({
    ...input,
    isComplete: true,
  });
  expect(completeProfileIfUnchanged).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'synthetic-user',
      selectedMemberKind: MemberKind.STUDENT,
    }),
    {
      name: input.name,
      studentId,
      department: input.department,
      memberKind: MemberKind.STUDENT,
      affiliationKind: 'DEPARTMENT',
      affiliationName: input.department,
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
  );
  expect(updateProfileFields).not.toHaveBeenCalled();
});

it('미완료 프로필에 학번이 없으면 400 검증 오류로 거부한다', async () => {
  const { service, completeProfileIfUnchanged, updateProfileFields } =
    buildService();

  const error = await captureDomainException(() =>
    service.completeMyProfile(githubId, {
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
    service.patchMyProfile(githubId, { ...input, studentId: '9'.repeat(6) }),
  );

  expect(error.errorCode.code).toBe(UsersErrorCode.STUDENT_ID_IMMUTABLE);
  expect(error.errorCode.status).toBe(400);
  expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
  expect(updateProfileFields).not.toHaveBeenCalled();
});
